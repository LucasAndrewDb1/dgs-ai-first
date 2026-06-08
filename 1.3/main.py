#RAG PIPELINE DB1 - AUTOR: LUCAS ANDREW FERNANDES SANTOS

import os

from dotenv import load_dotenv

from langchain_chroma import Chroma
from langchain_community.document_loaders import TextLoader, DirectoryLoader
from langchain_community.retrievers import BM25Retriever
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from sentence_transformers import CrossEncoder

class HybridRerankRetriever:
    def __init__(self, dense, sparse, reranker, weights):
        self.dense, self.sparse, self.reranker, self.weights = dense, sparse, reranker, weights

    def invoke(self, query):
        pool = reciprocal_rank_fusion(
            [self.dense.invoke(query), self.sparse.invoke(query)], self.weights
        )
        if not pool:
            return []
        return self.reranker.compress_documents(pool, query=query)

class HybridRerankRetriever:
    def __init__(self, dense, sparse, reranker, weights, final_k):
        self.dense, self.sparse, self.reranker, self.weights = dense, sparse, reranker, weights
        self.final_k = final_k

    def invoke(self, query):
        pool = reciprocal_rank_fusion(
            [self.dense.invoke(query), self.sparse.invoke(query)], self.weights
        )
        if not pool:
            return []
        pairs = [(query, doc.page_content) for doc in pool]
        scores = self.reranker.predict(pairs)
        for doc, score in zip(pool, scores):
            doc.metadata["rerank_score"] = float(score)
        pool.sort(key=lambda d: d.metadata["rerank_score"], reverse=True)
        return pool[:self.final_k]

load_dotenv()

DOCUMENTS_PATH = "./docs"
VECTOR_STORE_DIRECTORY = "db/chroma_db"

EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B"
RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"

CHUNK_SIZE = 1200
CHUNK_OVERLAP = 150

RRF_K = 60
CANDIDATE_POOL = 20
DENSE_K = 10
SPARSE_K = 10
FINAL_K = 5
ENSEMBLE_WEIGHTS = [0.5, 0.5]

def load_documents(doc_path):
    print(f"Loading path: '{doc_path}'")
    if not os.path.exists(doc_path):
        raise FileNotFoundError(f"Directory '{doc_path}' does not exist.")

    loader = DirectoryLoader(
        path=doc_path,
        glob="**/*.md",
        loader_cls=TextLoader,
        loader_kwargs={"encoding": "utf-8", "autodetect_encoding": True},
        show_progress=True,
        use_multithreading=True,
    )
    documents = loader.load()
    if len(documents) == 0:
        raise FileNotFoundError(f"No '.md' files found in path: '{doc_path}'")

    print(f"Loaded {len(documents)} document(s).")
    return documents

def split_documents(documents):
    print("Splitting markdown documents into chunks...")

    headers_to_split_on = [("#", "h1"), ("##", "h2"), ("###", "h3")]
    md_splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=headers_to_split_on,
        strip_headers=False,
    )
    char_splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", " ", ""],
    )

    section_docs = []
    for doc in documents:
        sections = md_splitter.split_text(doc.page_content)
        for section in sections:
            section.metadata = {**doc.metadata, **section.metadata}
        section_docs.extend(sections)

    chunks = char_splitter.split_documents(section_docs)

    for i, chunk in enumerate(chunks):
        src = chunk.metadata.get("source", "doc")
        chunk.metadata["chunk_id"] = f"{src}::{i}"
    print(f"Produced {len(chunks)} chunk(s).")

    return chunks

def load_vector_store(embedding, persist_directory):
    return Chroma(persist_directory=persist_directory, embedding_function=embedding)

def create_vector_store(chunks, embedding, persist_directory):
    print("Creating vector store...")
    vector_store = Chroma.from_documents(
        documents=chunks,
        embedding=embedding,
        persist_directory=persist_directory,
        collection_metadata={"hnsw:space": "cosine"},
    )
    print(f"Vector store created and saved to: '{persist_directory}'")
    return vector_store

def initialize_vector_store_data(embedding, documents_path, persist_directory):
    documents = load_documents(documents_path)
    chunks = split_documents(documents)
    return create_vector_store(chunks, embedding, persist_directory)

def get_chunks_from_store(vector_store):
    data = vector_store.get(include=["documents", "metadatas"])
    contents = data.get("documents") or []
    metadatas = data.get("metadatas") or []

    docs = []
    for content, meta in zip(contents, metadatas):
        if content:
            docs.append(Document(page_content=content, metadata=meta or {}))
    return docs

def build_dense_retriever(vector_store):
    return vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": DENSE_K},
    )

def build_sparse_retriever(chunks):
    sparse = BM25Retriever.from_documents(chunks)
    sparse.k = SPARSE_K
    return sparse

def reciprocal_rank_fusion(result_lists, weights, k=RRF_K, top_n=CANDIDATE_POOL):
    scores, docs_by_id = {}, {}
    for docs, weight in zip(result_lists, weights):
        for rank, doc in enumerate(docs, start=1):
            doc_id = doc.metadata["chunk_id"]
            scores[doc_id] = scores.get(doc_id, 0.0) + weight / (k + rank)
            docs_by_id[doc_id] = doc
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
    fused = []
    for doc_id, score in ranked:
        doc = docs_by_id[doc_id]
        doc.metadata["rrf_score"] = score
        fused.append(doc)
    return fused

def build_retriever(vector_store):
    chunks = get_chunks_from_store(vector_store)
    if not chunks:
        raise RuntimeError("Vector store is empty. cannot build the sparse index.")

    dense = build_dense_retriever(vector_store)
    sparse = build_sparse_retriever(chunks)
    reranker = CrossEncoder(RERANKER_MODEL)
    return HybridRerankRetriever(dense, sparse, reranker, ENSEMBLE_WEIGHTS, FINAL_K)

def main():
    embedding = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)

    if os.path.exists(VECTOR_STORE_DIRECTORY):
        vector_store = load_vector_store(embedding, VECTOR_STORE_DIRECTORY)
    else:
        vector_store = initialize_vector_store_data(
            embedding, DOCUMENTS_PATH, VECTOR_STORE_DIRECTORY
        )

    print("Building hybrid retriever with cross-encoder reranking...")
    retriever = build_retriever(vector_store)
    print("Ready.")

    while True:
        question = input("\nQuestion (or 'exit'): ")
        if question.lower() == "exit":
            break

        results = retriever.invoke(question)
        if not results:
            print("No relevant documents found.")
            continue

        print(f"\nFound {len(results)} relevant chunks:\n")
        for i, doc in enumerate(results, start=1):
            source = doc.metadata.get("source", "unknown")
            score = doc.metadata.get("rerank_score")
            header = " > ".join(
                str(doc.metadata[h]) for h in ("h1", "h2", "h3") if doc.metadata.get(h)
            )

            print(f"--- Chunk {i} ---")
            print(f"source : {source}")
            if header:
                print(f"section: {header}")
            if score is not None:
                print(f"score  : {score:.4f}")
            print(doc.page_content)
            print()

if __name__ == "__main__":
    main()