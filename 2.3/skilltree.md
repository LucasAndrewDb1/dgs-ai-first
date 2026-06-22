# Skills NovaTech — Arquitetura Foundation → Domain → Artifact

## Visão geral da árvore

```
NovaTech Skills
│
├── FOUNDATION  (base transversal — herdada por tudo)
│   ├── novatech-conventions
│   └── skill-authoring
│
├── DOMAIN  (conhecimento de domínio NovaTech — consumido pelos artefatos)
│   ├── rag-architecture
│   ├── azure-functions-platform
│   └── frontend-design-system
│
└── ARTIFACT  (geradores concretos dos artefatos repetidos)
    ├── rag-endpoint              → Endpoints Azure Functions com padrão RAG
    ├── integration-test          → Testes de integração
    ├── react-component           → Componentes React
    ├── adr                       → ADRs
    ├── readme                    → READMEs
    └── sdd-spec                  → Specs SDD
```

**Regra de dependência:** Artifact depende de Domain, Domain depende de Foundation. Nunca o contrário. Uma skill de Artifact nunca redefine convenções — ela invoca a Foundation/Domain correspondente.

---

## FOUNDATION

Camada base, estável, raramente alterada. Define "como a NovaTech escreve qualquer coisa".

| Nome | Descrição (frase de ativação) | Quem cria | Quem consome | Frequência |
|------|-------------------------------|-----------|--------------|------------|
| **novatech-conventions** | "Ao escrever ou revisar qualquer código/documento NovaTech — naming, idioma, estrutura de pastas, padrões de commit e lin/format." | Arquitetura / Tech Lead | Todas as skills Domain e Artifact (herança implícita) | Constante (referência passiva) |
| **skill-authoring** | "Ao criar, editar ou avaliar uma skill NovaTech — formato, frase de ativação, layering Foundation→Domain→Artifact." | Plataforma / Dev Experience | Mantenedores de skills (todas as outras) | Baixa (só ao evoluir o catálogo) |

---

## DOMAIN

Camada de conhecimento específico do produto. Encapsula decisões arquiteturais que mais de um artefato reaproveita.

| Nome | Descrição (frase de ativação) | Quem cria | Quem consome | Frequência |
|------|-------------------------------|-----------|--------------|------------|
| **rag-architecture** | "Ao implementar recuperação, chunking, embeddings, prompt assembly ou citações no pipeline RAG da NovaTech." | Squad de IA / Arquiteto de RAG | `rag-endpoint`, `integration-test`, `sdd-spec` | Média–alta |
| **azure-functions-platform** | "Ao criar bindings, configuração, autenticação, observabilidade ou deploy de Azure Functions na NovaTech." | Plataforma / Cloud | `rag-endpoint`, `integration-test`, `readme` | Média–alta |
| **frontend-design-system** | "Ao usar tokens de design, acessibilidade, estado e padrões de UI da NovaTech no front-end." | Squad de Front-end / Design System | `react-component`, `sdd-spec` | Média |

---

## ARTIFACT

Camada concreta — uma skill por artefato repetido. É onde os times passam a maior parte do tempo.

| Nome | Descrição (frase de ativação) | Quem cria | Quem consome | Frequência |
|------|-------------------------------|-----------|--------------|------------|
| **rag-endpoint** | "Ao criar um novo endpoint Azure Functions seguindo o padrão RAG (entrada → recuperação → geração → resposta com citações)." | Squad de IA | Devs back-end / IA | **Alta** |
| **integration-test** | "Ao escrever testes de integração para endpoints, pipelines RAG ou bindings Azure." | QA / Devs back-end | Devs back-end / IA | **Alta** |
| **react-component** | "Ao criar um novo componente React seguindo o design system NovaTech (estrutura, props, testes, acessibilidade)." | Squad de Front-end | Devs front-end | **Alta** |
| **adr** | "Ao registrar uma decisão arquitetural (contexto, opções, decisão, consequências) no formato ADR NovaTech." | Tech Leads / Arquitetos | Todos os times técnicos | Média |
| **readme** | "Ao gerar ou atualizar o README de um serviço/pacote no padrão NovaTech." | Qualquer dev (autor do módulo) | Todos os times | Média |
| **sdd-spec** | "Ao escrever uma especificação SDD (Spec-Driven Development) antes de implementar uma feature." | PO / Tech Lead / Dev | Squad da feature + revisores | Média–alta (gatilho de início de feature) |

---