---
source_url: "https://media.x.ai/v1/website/card-4p6-4cd2dc57.pdf"
captured_at: "2026-09-13T03:03:14.600870+00:00"
contributor: "Foreman release research; Scrapling"
---

Model Card:
Grok 4.6
August 12, 2026


Revision: 2026-08-17
GROK 4.6 MODEL CARD


Changelog

August 17, 2026

• Updated section numbering for consistency across the card inventory.
• Added PartBench results and graph.
• Added new DeepSearchQA results.
• Updated KernelBenchInternal to version 1.1, reporting results on more difficult task split.
• Clarity updates to prose and figures.
• Corrected eval results on HackerBench v0.2, Self-harm, MASK, LAB.


                                                  1
GROK 4.6 MODEL CARD


Contents

1   Introduction                                                                                        5
    1.1   Overview . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .       5
    1.2   Model development and training . . . . . . . . . . . . . . . . . . . . . . . . . . .          6

2 Coding capabilities                                                                                    7
    2.1   CursorBench 3.2 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .        7
    2.2 APEX-SWE . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .          9
    2.3 FrontierCode v1.1 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .       10
    2.4 DeepSWE v1.1 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .        11
    2.5 SWE-Marathon v1.1 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .           12
    2.6 Terminal-Bench 3.0 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .          13

3 Knowledge-work capabilities                                                                           14
    3.1   AA GDPVal . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .       14
    3.2 AA-Briefcase . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .        15
    3.3 APEX-Agents . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .         16
    3.4 OfficeQA Pro . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .        17
    3.5 Legal Agent Benchmark . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .           18

4 Engineering acceleration                                                                              19
    4.1   EEBench     . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .   19
    4.2 3DCodeBench . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 20
    4.3 PartBench . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .       21
    4.4 CADGenBench . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .           21
    4.5 CADBench . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .          22

5 R&D enablement                                                                                        23
    5.1   SpaceXAI MTS Eval . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 23
    5.2 InferenceEval . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 24
    5.3 KernelBenchInternal v1.1 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 25


                                                    2
GROK 4.6 MODEL CARD


6 Search capabilities and factuality                                                               26
   6.1   Factuality (Hallucination) . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 26
   6.2 DeepSearchQA . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .       27

7 Cyber capabilities and safeguards                                                                28
   7.1   CyberGym . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 28
   7.2 CVE-Bench . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 29
   7.3 SecureCodeReview . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 29
   7.4 HackerBench v0.2 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 30

8 Biological and chemical capabilities and safeguards                                               31
   8.1   Virology Capabilities Test (VCT) . . . . . . . . . . . . . . . . . . . . . . . . . . .     31
   8.2 Biosecurity VCT . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 32
   8.3 BioUseBench . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 32
   8.4 WMDP dual-use knowledge (MCQ) . . . . . . . . . . . . . . . . . . . . . . . . . 32
   8.5 LAB-Bench practical MCQ . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 33
   8.6 ProtocolQA Open-Ended . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 33
   8.7 BixBench zero-shot MCQ . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 33

9 Jailbreaks and robustness                                                                        34
   9.1   Jailbreaks . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 34

10 General output safety                                                                           35
   10.1 General refusals . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 35
   10.2 Child safety . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 36
   10.3 CBRN / weapons refusals . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 36

11 Mental health                                                                                    37
   11.1 Self-harm refusals . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 37

12 Behaviors                                                                                        37
   12.1 MASK-Rectified . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 37
   12.2 Sycophancy       . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 38


                                                  3
GROK 4.6 MODEL CARD


References                40


                      4
GROK 4.6 MODEL CARD


1   Introduction

Grok 4.6 is the latest release in SpaceXAI’s* 1.5T-scale model family, developed in
collaboration with Cursor† . It extends Grok 4.5, demonstrating greater capability and
autonomy on coding, engineering, and office work tasks, while also improving in new
domains of work (for example, AI research enablement and inference optimization).
It is our most capable model to date.


1.1 Overview

Grok 4.6 is capable of autonomously completing longer and more challenging tasks than
any of our previous models, reaching results with fewer steps and fewer output tokens than
other frontier models.
The primary purpose of this model card is to detail the capabilities of Grok 4.6 in
quantitative and objective terms, to indicate where this model is most useful. We document
safety domains (cyber, bio knowledge, bio agentic, jailbreaks/robustness, general output
safety including CBRN refusals, mental health, and behaviors) and our safeguards below.
Each evaluation under a capability or safety section has its own subsection. Unless stated
otherwise, evaluation results are on the final deployed checkpoint of Grok 4.6.
We never silently downgrade intelligence or fall back to other models. Our goal is to
preserve legitimate uses of the model: engineering and creative work, scientific research,
hardening critical infrastructure, and AI research.
The model’s use is subject to SpaceXAI’s Acceptable Use Policy1 , applicable Consumer
and Enterprise Terms of Service, and any applicable laws. Grok 4.6 is not intended for
autonomous high-stakes decision-making in domains such as medicine, law, finance, or
safety-critical systems without appropriate human oversight and domain-expert validation.


*   SpaceXAI is a doing-business-as (DBA) name of XAI LLC. xAI and SpaceXAI may be used interchangeably
    throughout this card.
†
    Grok 4.6 received supplemental training on anonymized Cursor workflow data to improve coding and
    agentic performance.


                                                   5
GROK 4.6 MODEL CARD


Grok 4.6 is primarily a text model: it accepts natural-language text and images as input and
produces text as output. It is available for use through the following channels:

• SpaceXAI API: Available from the console at console.x.ai; API users can call Grok 4.6
  through the standard chat and completions endpoints.
• Grok Build: The default model in SpaceXAI’s terminal-based coding agent, available
  through both the API and the CLI.
• Cursor: Available to all users, on every plan tier.
• Office add-ins: The default model in the Grok by SpaceXAI add-ins for Microsoft Word,
  PowerPoint, and Excel.
• Model gateways: Reachable through OpenRouter, Vercel, Cloudflare, Snowflake,
  Databricks Mosaic, and others.

SpaceXAI plans to add Grok 4.6 to its consumer surfaces (web, mobile apps, and Grok-in-X
on the X platform) at a later date.


1.2   Model development and training

Grok 4.6 was pretrained on publicly available data, data generated internally, as well as
other data to which SpaceXAI has secured the necessary rights, followed by supplemental
training and post-training with supervised fine-tuning (SFT) and reinforcement learning
(RL) on human and synthetic reward signals.
Supplemental training for Grok 4.6 ran longer than for Grok 4.5, combining model-generated
data curated for reasoning and advanced technical concepts, high-quality engineering
corpora, and an improved optimizer and recipe. Grok 4.5 models were used to generate
SFT trajectories across reasoning efforts, agent harnesses, and domains spanning
STEM, software engineering, and knowledge work, with model-based checks screening
out problematic traces. Agentic RL covered knowledge work, general coding, and
purpose-built environments for kernel optimization, web development, and computer-aided
design.
Grok 4.6 has a pretraining data cutoff of January 2026, and uses data generated as late as
June 2026 in its supplemental training.


                                               6
GROK 4.6 MODEL CARD


2    Coding capabilities

Grok 4.6 is built for strong coding performance across wide-ranging domains of software
engineering, problem-solving, and software-engineering-adjacent tasks.
Grok 4.6’s other abilities (in office work, R&D, and CAD) depend on well-developed
baseline coding capabilities: an agent that reads, writes, and runs code is a prerequisite for
expressive interaction with any digital tool, file, or workflow.
We primarily evaluate coding on agentic benchmarks of real-world software engineering,
problem-solving, and software-engineering-adjacent tasks, such as SRE and observability.
These benchmarks cover Cursor IDE-style agent workflows, repository-level issue
resolution, terminal use, and other software-engineering-relevant use cases.


2.1 CursorBench 3.2 2

CursorBench 3.2 evaluates coding agents on realistic IDE-style tasks from production-like
Cursor workflows: multi-file edits, natural-language instructions, tools, APIs and MCPs,
and iterative fixing.
We evaluate Grok 4.6 with the Cursor agent harness on a fixed set of tasks.* Grok 4.6
scores 70.8% at xhigh thinking effort, exceeding the other models tested, and 69.9%
at high thinking effort, improving on Grok 4.5 high at 66.7%.† Averaging 41,136 output
tokens per task at xhigh, Grok 4.6 sits at the frontier of capability and efficiency on this
benchmark.
                                              Score vs tokens
                                                Opus 5       Grok 4.6

                   70%                                                                 Grok 4.5
                         Fable 5

                   60%                                   Kimi K3


       Score (%)
                                                                                            GPT-5.6 Sol


                   50%
                                                                         Sonnet 5

                                                                                     GPT-5.6 Terra
                   40%
                                                                            GPT-5.6 Luna

                            100k       80k         60k             40k         20k          0
                                        Average output tokens per task

*   Results reported are taken from evaluations conducted by Cursor.
†
    Grok 4.5 was served with a maximum thinking effort of high.


                                                     7
GROK 4.6 MODEL CARD


                                         Score vs cost
                                                Opus 5                 Grok 4.6
                                                         GPT-5.6 Sol
                 70%                                                                  Grok 4.5

                               Fable 5

                 60%


     Score (%)
                                                                 Kimi K3

                 50%
                                                                       Sonnet 5

                                                                           GPT-5.6 Terra
                 40%
                                                                       GPT-5.6 Luna

                   $18   $15   $12           $9            $6           $3            $0
                                     Average cost per task


                                            8
GROK 4.6 MODEL CARD


2.2     APEX-SWE 3

APEX-SWE measures AI productivity on software-engineering work spanning integration
tasks and observability tasks (e.g. diagnosing failures from telemetry). Coding agents now
see active use in maintenance and observability work, representing a materially different
task profile from that evaluated by typical software engineering benchmarks. Therefore, we
run APEX-SWE to measure Grok 4.6’s capabilities in this domain.
Grok 4.6’s performance on APEX-SWE is evaluated with the Terminus-2 harness4 . Grok 4.6
scores 56.4% at high thinking effort.


                       Opus 5 (max)                                                          63.7%


         Fable 5 (max, with fallback)                                                   58.8%


                     Grok 4.6 (high)                                                  56.4%


                     Grok 4.5 (high)                                                 53.6%


                      Kimi K3 (max)                                           48.0%


                     Sonnet 5 (max)                                          46.4%


                GPT-5.6 Sol (xhigh)                                          45.8%


                     Opus 4.8 (max)                                      43.9%


                    GPT-5.5 (xhigh)                                  37.0%


                                                Pass@1 (%)*


*     Results reported are taken from evaluations conducted by Mercor.


                                                       9
GROK 4.6 MODEL CARD


2.3 FrontierCode v1.1 5

Correctness alone is an insufficient metric of real-world software engineering utility of a
model. Characteristics such as code style, test coverage, and scope-discipline are salient
metrics of code utility and quality that are difficult to capture in gold-patch difference
benchmarks. FrontierCode v1.1 measures whether AI-generated pull requests would be
mergeable by open-source maintainers, measuring behavioral correctness, regression
safety, scope discipline, style, and adherence to codebase conventions. We run the
extended set of 150 samples to provide a more comprehensive evaluation of the model’s
capabilities.
Submissions are graded against maintainer-authored rubrics, verifiers, and hard blocker
criteria.*
Grok 4.6’s performance on FrontierCode v1.1 is evaluated with the Grok Build harness. Grok
4.6 scores 61.3% at high thinking effort.


       Fable 5 (max, with fallback)                                                64.9%


                     Opus 5 (max)                                                 63.6%


                   Grok 4.6 (high)                                            61.3%


                GPT-5.6 Sol (max)                                             60.6%


                   Opus 4.8 (max)                                            59.6%


                  GPT-5.5 (xhigh)                                          56.7%


                   Grok 4.5 (high)                                         56.6%


                   Sonnet 5 (max)                                          56.2%


                          SWE-1.7                                         54.3%


                                          Extended score (%)†


*   SWE-1.7 (Cognition) scores are reported without effort.
†
    Results reported are taken from evaluations conducted by Cognition.


                                                    10
GROK 4.6 MODEL CARD


2.4 DeepSWE v1.1 6

DeepSWE v1.1 is the updated release of the DeepSWE agentic-coding benchmark,
measuring end-to-end completion of long-horizon software engineering tasks. It serves
as a proxy for the model’s ability to handle real-world software engineering work, and is
selected due to being highly contamination-resistant.
Grok 4.6 is evaluated with the mini-swe-agent harness7 . Grok 4.6 scores 65.9% at high
thinking effort and 67.0% at xhigh thinking effort. For non-Grok models, peer numbers use
the best result available from model cards or evaluator-reported sources.


                     Opus 5 (max)                                                     74.0%


                GPT-5.6 Sol (max)                                                     73.0%


       Fable 5 (max, with fallback)                                                 70.0%


                    Kimi K3 (max)                                                   69.0%


                  Grok 4.6 (xhigh)                                                67.0%


                  GPT-5.5 (xhigh)                                                 67.0%


                   Grok 4.6 (high)                                                65.9%


                   Opus 4.8 (max)                                           59.0%


                   Grok 4.5 (high)                                        54.0%


                   Sonnet 5 (max)                                         54.0%


                                              Pass@1 (%)*


*   Results reported are taken from evaluations conducted by Datacurve.


                                                    11
GROK 4.6 MODEL CARD


2.5     SWE-Marathon v1.1 8

Correctness, goal consistency, and completeness become increasingly important as agents
become capable of larger-scope and more open-ended software engineering work.
SWE-Marathon is selected as a benchmark of ultra-long-horizon engineering work that can
require millions of tokens and multi-hour trajectories; scoring uses multi-layer verification
designed to resist reward hacking and shortcuts.
Grok 4.6 is evaluated with the Grok Build harness; peer models use their respective
provider harnesses. Grok 4.6 scores 31.9% at high thinking effort.


                       Opus 5 (max)                                                     50.0%


                     Opus 4.8 (max)                                                    48.8%


                      Kimi K3 (max)                                                48.1%


         Fable 5 (max, with fallback)                                            45.0%


                  GPT-5.6 Sol (max)                                            42.5%


                     Grok 4.6 (high)                                   31.9%


                     Sonnet 5 (max)                                  30.0%


                     Grok 4.5 (high)                                 29.4%


                                            Resolution rate (%)*


*     Results reported are taken from evaluations conducted by Abundant AI.


                                                      12
GROK 4.6 MODEL CARD


2.6 Terminal-Bench 3.0 9

Terminal-Bench 3.0 is the successor benchmark to Terminal-Bench 2.1,* continuing the
same terminal-agency evaluation line with an expanded task set and refreshed harness.
It measures agents on hard, realistic command-line tasks across software, ML, science,
security, ops, hardware, and media workflows inside containerized terminal environments.
Grok 4.6 is evaluated with the Grok Build harness. Grok 4.6 scores 26.0% at high thinking
effort.

                     Opus 5 (max)                                                        43.5%


                GPT-5.6 Sol (max)                                                34.6%


       Fable 5 (max, with fallback)                                              34.1%


                   Grok 4.6 (high)                                       26.0%


                   Opus 4.8 (max)                                21.1%


                   Grok 4.5 (high)                       15.7%


                   Sonnet 5 (max)                     14.6%


                                         Task success rate (%)†


*   The suite was formerly published under the name FrontierBench.
†
    Results reported are taken from evaluations conducted by Harbor.


                                                    13
GROK 4.6 MODEL CARD


3 Knowledge-work capabilities

We evaluate performance on professional knowledge-work and structured agent tasks
relevant to office and productivity use cases, in order to quantify Grok 4.6’s utility in
assisting, accelerating, and automating knowledge work. We select these benchmarks for
task- and domain-diversity, as well as for alignment with subjective user experiences of
performance (that is, a higher score is consistent with a material improvement in the utility
of the tested model and the quality of produced artifacts).
On all tested domains, Grok 4.6 demonstrates frontier or near-frontier performance.


3.1 AA GDPVal 10

AA GDPVal (GDPval-AA v2) evaluates models on economically valuable knowledge-work
deliverables (documents, analyses, and professional artifacts) spanning occupations that
contribute substantially to GDP.
Artificial Analysis runs GDPval-style tasks with pairwise quality ratings under its GDPval-AA
v2 harness. Grok 4.6 scores 1753 Elo at high thinking effort.


                     Opus 5 (max)                                                                 1849


                    Grok 4.6 (high)                                                          1753


       Fable 5 (max, with fallback)                                                          1741


                GPT-5.6 Sol (max)                                                           1728


                     Kimi K3 (max)                                                         1682


                    Sonnet 5 (max)                                                    1601


                   Opus 4.8 (max)                                                     1588


              GPT-5.6 Terra (max)                                                     1578


                    Grok 4.5 (high)                                                 1526


                   GPT-5.5 (xhigh)                                                  1490


                          Grok 4.3                                    1085


                                              AA GDPVal Elo*


*   Results reported are taken from evaluations conducted by Artificial Analysis.


                                                      14
GROK 4.6 MODEL CARD


3.2 AA-Briefcase 11

AA-Briefcase evaluates frontier agents on long-horizon, multi-week professional
knowledge-work projects that produce deliverables such as spreadsheets, presentations,
memos, financial models, and PDFs.
Scenarios are expert-built, multi-file, and offline (no internet). Grading combines rubric
pass rate with pairwise analytical-quality and presentation judgments. Grok 4.6 is
evaluated with the Artificial Analysis harness.
Grok 4.6 scores 1577 Elo at high thinking effort.


                     Opus 5 (max)                                                                 1715


                    Grok 4.6 (high)                                                         1577


       Fable 5 (max, with fallback)                                                        1574


                     Kimi K3 (max)                                                         1541


                GPT-5.6 Sol (max)                                                       1502


                    Sonnet 5 (max)                                                  1383


                   Opus 4.8 (max)                                                1340


                    Grok 4.5 (high)                                              1313


                   GPT-5.5 (xhigh)                                        1150


                                             AA-Briefcase Elo*


*   Results reported are taken from evaluations conducted by Artificial Analysis.


                                                      15
GROK 4.6 MODEL CARD


3.3 APEX-Agents 12

APEX-Agents measures whether frontier agents can autonomously complete long-horizon,
cross-application professional tasks in realistic simulated work environments spanning
investment banking, management consulting, and corporate law.
Agents operate over multi-app projects (documents, spreadsheets, presentations, email,
chat, files) and are graded with expert binary rubrics: a task fully succeeds only if all criteria
are met. Grok 4.6 is evaluated with the Mercor harness. Grok 4.6 scores 57.5% at high
thinking effort.


                     Opus 5 (max)                                                  60.6%


       Fable 5 (max, with fallback)                                               59.2%


                   Grok 4.6 (high)                                               57.5%


                GPT-5.6 Sol (max)                                               56.7%


                   Opus 4.8 (max)                                               56.2%


                  GPT-5.5 (xhigh)                                               55.5%


                    Kimi K3 (max)                                               55.4%


                   Grok 4.5 (high)                                      47.1%


                   Sonnet 5 (high)                              32.5%


                                              Pass@1 (%)*


*   Results reported are taken from evaluations conducted by Mercor.


                                                    16
GROK 4.6 MODEL CARD


3.4 OfficeQA Pro 13

OfficeQA Pro evaluates models on professional office question-answering across realistic
workplace documents and workflows.
Grok 4.6 is evaluated with the Databricks harness. Grok 4.6 scores 63.2% at high thinking
effort.

                   Grok 4.6 (high)                                         63.2%


                     Opus 5 (max)                                        60.9%


       Fable 5 (max, with fallback)                                      60.9%


                GPT-5.6 Sol (max)                                        60.2%


                                              Accuracy (%)*


*   Results are taken from evaluations conducted by Databricks.


                                                     17
GROK 4.6 MODEL CARD


3.5 Legal Agent Benchmark 14

Legal Agent Benchmark (LAB, also known as the Harvey Legal Agent Benchmark) is a
long-horizon legal-agent evaluation in which agents complete realistic, multi-step legal
work over client-matter files and produce reviewable work product graded with expert
all-pass rubrics.
Scores reported here use the Vals AI third-party implementation using the Valkyrie
harness15 (Vals AI’s agentic evaluation framework), with a fixed tool and skill set. The agent
has six tools: Read File, Edit File, Write File, Glob, Bash, and Grep, as well as three skills:
(docx, pptx, and xlsx). The benchmark was adapted to run on Valkyrie and Vals’s model
library; these are infrastructure changes that do not affect model performance. Harvey’s
original generation and grading protocol is followed (internet access disabled), and results
are reported with the same methodology as Harvey’s initial leaderboard.
Grok 4.6 is evaluated with the Vals AI (Valkyrie) harness. Grok 4.6 scores 15.8% at high
thinking effort.

                   Grok 4.6 (high)                                             15.8%


                   Grok 4.5 (high)                                    12.9%


                     Opus 5 (max)                                  11.7%


       Fable 5 (max, with fallback)                               11.3%


                GPT-5.6 Sol (max)            2.5%


                                                    Score*


*   Results are taken from evaluations conducted by Vals AI.


                                                      18
GROK 4.6 MODEL CARD


4 Engineering acceleration

Engineering represents one of the core domains where improved agent capabilities directly
support the acceleration of technological development: agents that accelerate rocket
design, IC layout, and datacenter power-and-cooling optimization compress the timelines
of progress across the physical systems that enable further advances in AI capabilities and
utility.
We evaluate Grok 4.6 on agentic tasks that accelerate physical-world engineering (i.e. all
engineering not purely within the software domain): electrical and chip design, procedural
3D modeling via code, parametric CAD and part generation, and related workflows where
models must reason about geometry, materials, and real devices rather than repositories
alone.


4.1 EEBench 16

EEBench is an electrical engineering and chip design benchmark: models design circuits
and other hardware that are graded for physical correctness and functionality.* Grok
4.6 is evaluated with the Grok Build harness; peer models use their respective provider
harnesses.
Grok 4.6 scores 60.0% at xhigh thinking effort and 53.0% at high thinking effort.


                     Opus 5 (max)                                                  61.6%


                  Grok 4.6 (xhigh)                                               60.0%


       Fable 5 (max, with fallback)                                        54.2%


                   Grok 4.6 (high)                                        53.0%


                   Opus 4.8 (max)                                        51.4%


                   Grok 4.5 (high)                                       50.9%


                  GPT-5.5 (xhigh)                                42.3%


                GPT-5.6 Sol (max)                              39.4%


                    Kimi K3 (max)                              38.3%


                                               Reward (%)†


*   As part of the V1 core corpus of the benchmark.
†
    Results are taken from evaluations conducted by Atopile.


                                                     19
GROK 4.6 MODEL CARD


4.2 3DCodeBench 17

3DCodeBench evaluates agentic procedural 3D modeling via code. An agent is tasked with
authoring engine-ready 3D assets through software APIs and geometric reasoning, and
is graded for executability and shape fidelity. We evaluate Grok 4.6 with the Grok Build
harness.
Grok 4.6 scores 54.0% at high thinking effort.


                  Grok 4.6 (high)                                               54.0%


                    Opus 5 (max)                                          49.9%


                  Grok 4.5 (high)                                         49.8%


                  Opus 4.8 (max)                                        47.0%


      Fable 5 (max, with fallback)                                 43.7%


                  Sonnet 5 (max)                                39.2%


                                                   Reward (%)


                                            20
GROK 4.6 MODEL CARD


4.3 PartBench 18

PartBench evaluates agents on parametric mechanical part design and CAD-style
generation tasks graded for geometric and manufacturing fidelity.
Grok 4.6 is evaluated with the Grok Build harness; peer models use their respective
provider harnesses. Grok 4.6 scores 58.5% at xhigh thinking effort.

       Fable 5 (max, with fallback)                                               59.9%


              GPT-5.6 Sol (xhigh)                                                 59.0%


                  Grok 4.6 (xhigh)                                            58.5%


                     Opus 5 (max)                                         52.4%


                                               Reward (%)*


4.4 CADGenBench 19

CADGenBench evaluates agents on CAD model construction from design prompts. We
report the generation split of the benchmark: the model must produce CAD geometry
graded for executability and geometric correctness.
Grok 4.6 is evaluated with the Grok Build harness; peer models use their respective
provider harnesses. Grok 4.6 scores 40.9% at high thinking effort.

            Grok 4.6 (high)                                                   40.9%


       GPT-5.6 Sol (xhigh)                                                37.1%


              Opus 5 (max)                                               36.6%


            Grok 4.5 (high)                                           33.2%


                                               Reward (%)†


*   Results are taken from evaluations conducted by Normal Factory.
†
    Results are taken from evaluations conducted by Mecado.


                                                    21
GROK 4.6 MODEL CARD


4.5 CADBench 20

CADBench evaluates agents on parametric CAD design and 3D modeling tasks, including
out-of-distribution generation.
Results are taken from the Grok Build harness, run by gNucleus. Grok 4.6 scores 88.4% at
xhigh thinking effort and 87.8% at high thinking effort.*

             Opus 5 (max)                                                                           90.6%


          Grok 4.6 (xhigh)                                                                        88.4%


           Grok 4.6 (high)                                                                        87.8%


        GPT-5.6 Sol (max)                                                                        86.5%


           Grok 4.5 (high)                                                                      83.7%


                                                            Reward (%)


*   Additional testing results with different harnesses are reported at https://cadbench.ai/.


                                                       22
GROK 4.6 MODEL CARD


5    R&D enablement

We evaluate Grok 4.6 on its ability to automate parts of the engineering and research
process for training and evaluating new versions of itself. Models that can contribute to
their own training pipelines, evaluation harnesses, and experimental design enable the
development of more capable models, enabling further reinforcement of the model-training
loop. We anticipate progress in this domain to significantly contribute to capability
improvements in other domains of work, such as engineering, coding, and computer-use;
we therefore quantify our model’s performance on tasks that measure progress toward this
goal.
As a test of autonomous AI-development acceleration, an earlier Grok 4.6 checkpoint was
tasked with speeding up its own chat inference, being free to experiment but required to
verify end-to-end gains before opening a pull request. In five real-world hours it worked
through 297 candidate optimizations across fused MoE, FMHA, kernel scheduling, and
communication, discarded those without measurable end-to-end gain (including several
that passed microbenchmarks), and opened seven pull requests; three now serve Grok
Chat production traffic, for a combined 1.5% decode and 3.1% prefill throughput gain.


5.1 SpaceXAI MTS Eval

The SpaceXAI MTS eval is an internal benchmark of frontier model-development tasks
common in the daily workflows of SpaceXAI engineers: diagnosing reward hacking
in training runs, generating and auditing training data, debugging large-scale training
infrastructure, and creating evaluations for emerging capabilities. This section covers the
standard (non-GPU) suite of the above eval.
Agents are scored on task reward under a fixed rollout budget (time and tokens). Refusals
are noted.* We evaluate Grok 4.6 with the Grok Build harness. Grok 4.6 scores 61.1% at
high thinking effort.


            Grok 4.6 (high)                                                             61.1%


            Grok 4.5 (high)                                                          57.1%


            Opus 4.8 (max)                                                         55.8%


              Opus 5 (max)                                                      52.6%


       GPT-5.6 Sol (xhigh)                                                      52.1%


           GPT-5.5 (xhigh)                                                46.4%


                  Grok 4.3                                           40.6%


                                                           % Correct

*   GPT-5.6 Sol refused 2/29 tasks and GPT-5.5 refused 1; scores for those models exclude the refused tasks.


                                                    23
GROK 4.6 MODEL CARD


5.2   InferenceEval

InferenceEval is an internal benchmark that tasks agents with implementing real production
changes in the code for SpaceXAI’s production inference stack. Each task starts from a
frozen pre-change image of the internal inference stack; the agent must land a working
patch under the Grok Build harness. Tasks are not a single bug class: some add missing
kernels or APIs, some fix scheduler or replay correctness, and some implement fusions,
layout, or quantization work that must preserve bit-exact tensors.
To more fairly measure capabilities on inference optimization tasks, we intentionally exclude
verification of results from the loop; scoring combines a hidden GPU unit score (exact
tensors, state, and CUDA-graph behavior) with a hidden integration probe that must pass
or the unit score is zeroed, plus a check that the patch implements the stated production
contract. These components are combined into the reported accuracy. We evaluate Grok
4.6 with the Grok Build harness.
Grok 4.6 scores 46.9% at high thinking effort.


          Grok 4.6 (high)                                                     46.9%


       GPT-5.6 Sol (max)                                                   44.1%


           Opus 5 (max)                                                43.0%


          Grok 4.5 (high)                                            41.3%


         Opus 4.8 (max)                                              40.7%


           Kimi K3 (max)                                            39.8%


         GPT-5.5 (xhigh)                                           38.9%


                                                  Accuracy (%)


                                             24
GROK 4.6 MODEL CARD


5.3 KernelBenchInternal v1.1

KernelBenchInternal v1.1 is an internal acceleration suite inspired by KernelBench21 and
related verified kernel-writing benchmarks. Each task provides a PyTorch reference model
and asks the agent to replace operators with custom CUDA for a faster implementation
of that operator class. Sampling and grading run in a sandboxed GPU environment with
standard coding tools, on the same class of accelerators used for model training.
Submitted kernels must compile, match the reference on a correctness trial, and then be
timed against a TF32 PyTorch baseline. The reported score depends on both correctness
and the size of the measured speedup. We evaluate Grok 4.6 with the Grok Build harness.
Grok 4.6 scores 37.2% at high thinking effort, improving on Grok 4.5 high at 29.7%.


           Opus 5 (max)                                                         48.1%


          Kimi K3 (max)                                                 41.0%


         Opus 4.8 (max)                                            37.5%


         Grok 4.6 (high)                                           37.2%


      GPT-5.6 Sol (max)                                         34.4%


        GPT-5.5 (xhigh)                                         34.0%


         Grok 4.5 (high)                                29.7%


                                                 Accuracy (%)


                                            25
GROK 4.6 MODEL CARD


6 Search capabilities and factuality

Core to SpaceXAI’s mission of truth-seeking is factual correctness, informational recency,
and verifiability.
We therefore evaluate grounded answering with search tools and factual reliability,
including in hallucination-prone settings.


6.1 Factuality (Hallucination)

Factuality (Hallucination) is an internal benchmark that measures how often the model
asserts unsupported or fabricated claims in a single response to an information-seeking
query. Lower is better.
A separate grader flags factually unsupported statements against retrieved or known
ground truth. We evaluate Grok 4.6 with the Grok Build harness. Grok 4.6 scores 1.7%
hallucination rate at high thinking effort.

       Opus 4.8 (max)                                                      3.4%


       Grok 4.6 (high)                             1.7%


      GPT-5.5 (xhigh)                  1.1%


       Grok 4.5 (high)               0.98%

                                              Hallucination rate (%)


                                              26
GROK 4.6 MODEL CARD


6.2     DeepSearchQA 22

DeepSearchQA evaluates end-to-end answer accuracy on questions that require
multi-step search and synthesis of retrieved information. Answers are graded for
correctness against reference answers.*
We evaluate Grok 4.6 with the Grok Build harness. Grok 4.6 scores 81.6% at high thinking
effort.

            GPT-5.5 (xhigh)                                                        87.8%


             Grok 4.5 (high)                                                      85.3%


            Opus 4.8 (max)                                                        84.8%


             Grok 4.6 (high)                                                 81.6%


         GPT-5.6 Sol (high)                                               75.0%


                                                          Accuracy (%)


*     Evaluation was run on an internal implementation of DeepSearchQA.


                                                     27
GROK 4.6 MODEL CARD


7   Cyber capabilities and safeguards

Models with advanced capability in coding and coding-adjacent (terminal-use) domains
also, in the absence of safeguards or controls, demonstrate enhanced abilities in defensive
and offensive cybersecurity. In this section, we discuss the results of the evaluation
suite we use to measure our models’ cyber capabilities, and additionally discuss the
effectiveness and calibration of our safeguard stack.
Grok 4.6 shows some cybersecurity-relevant capability gains over Grok 4.5, concentrated
in cyber-defense and vulnerability-mitigation tasks rather than end-to-end offensive
use. Capability tests are run without the safeguards we use in production, which would
otherwise mask the model’s full capability; refusal behavior under safeguards is measured
separately (see §7.4).
These capabilities are most useful to defenders: finding and fixing vulnerabilities rather
than carrying out end-to-end attacks.
We additionally provided an unrestricted configuration of Grok 4.6 to third-party evaluators,
who corroborated the results of our internal evaluations and testing on cyber capabilities.


7.1 CyberGym 23

CyberGym measures offensive cybersecurity capability by tasking an agent with
reproducing crashes and assembling working exploits for known vulnerabilities.
Because it is a capability probe rather than a refusal test, scores use the unrestricted
setting (without our standard safeguards) as a pure measure of ability; refusal behavior on
harmful cyber requests is measured separately (see §7.4). Other models’ unsafeguarded
results are taken from the respective model providers’ system cards24,25,26,27 where
available to avoid loss of signal due to refusals.
We evaluate Grok 4.6 with the Grok Build harness. Grok 4.6 scores 79.7% at high thinking
effort.

       GPT-5.6 Sol (max)                                                     83.6%


         GPT-5.5 (xhigh)                                                    81.8%


          Grok 4.6 (high)                                                  79.7%


          Grok 4.5 (high)                                                 79.0%


         Opus 4.8 (max)                                                   78.1%


                                              Mean Reproduced (%)


                                              28
GROK 4.6 MODEL CARD


7.2   CVE-Bench 28

CVE-Bench evaluates agents on exploiting real-world web-application CVEs in sandboxed
environments that mimic production services. The model is tested without safeguards in
place, in order to measure its cyber capabilities accurately.
We evaluate Grok 4.6 with the Grok Build harness. Grok 4.6 scores 39.8% at high thinking
effort.

                            Metric   Grok 4.5 (high)   Grok 4.6 (high)
                            Reward           35.2%               39.8%


7.3 SecureCodeReview

SecureCodeReview is an internal agentic software-engineering eval that scores both
whether the agent fixes the security issues present in a realistic codebase and whether its
patch avoids merging new security issues.
We evaluate Grok 4.6 with the Grok Build harness. Grok 4.6 scores 58.7% at high thinking
effort.

         GPT-5.5 (xhigh)                                                          64.1%


          Grok 4.6 (high)                                                 58.7%


       GPT-5.6 Sol (max)                                                  57.5%


          Grok 4.5 (high)                                         49.4%

                                                    Reward (%)


                                               29
GROK 4.6 MODEL CARD


7.4 HackerBench v0.2

HackerBench is a SpaceXAI internal CTF-style suite of cybersecurity and red-teaming
tasks that require chaining skills (recon, exploitation primitives, and reasoning about
vulnerable systems) in a constrained environment. HackerBench also includes borderline,
dual-use, and harmful-intent requests that should be refused, plus benign tasks that
should be completed. We use HackerBench, among other evaluations, metrics, and
qualitative tests, to measure the effectiveness and calibration of our safeguard stack.
HackerBench runs use the standard release-tracked safeguards for Grok 4.6 and the
standard provider-supplied safeguards for other tested models.
Grok 4.6 complies with 6.9% of dual-use requests at high thinking effort under our
standard safeguard stack. Grok 4.6 has a benign refusal rate of 0.0% at high thinking
effort.
          Grok 4.6 (high)     Grok 4.5 (high)           GPT-5.5 (xhigh)     Opus 4.8 (max)      GPT-5.6 Sol (max)


                                                35.7%                                    1.1%


                             25.0%
                                     22.8%


             6.9%     7.8%


                                                                          0.0%   0.0%           0.0%   0.0%
               Harmful/Dual-Use Compliance                                         Benign Refusal


                                                             30
GROK 4.6 MODEL CARD


8   Biological and chemical capabilities and safeguards

These suites probe dual-use biology and chemistry knowledge and lab-protocol
understanding, and are treated as safety-threshold evaluations under the xAI Frontier
Artificial Intelligence Framework (FAIF)29 , which defines the capability thresholds and
associated risk domains.
Grok 4.6 scores below the FAIF safety thresholds on dual-use knowledge, indicating
limited actionable uplift for an already-trained actor. Dual-use capability lift versus Grok
4.5 is noted in the biological domain but is limited (for example, a small VCT uptick);
weapons-path refusals are consistent with our safeguard stack and show improvement
over Grok 4.5; these results are reported separately under general output safety.
On general biological knowledge not useful for dual-use capability, Grok 4.6 shows
improvement over Grok 4.5.
Unless otherwise stated, the benchmarks presented in §8 are performed without
production safeguards in place; this enables full measurement of Grok 4.6’s dual-use
capabilities when unrestricted.


8.1 Virology Capabilities Test (VCT) 30

VCT presents multimodal virology problems and measures whether the model can
troubleshoot experimental lab protocols. It is a dual-use knowledge probe treated as a
CBRN safety-threshold evaluation: a higher score indicates stronger performance on
task distributions that overlap with dual-use capability, not better refusal behavior under
safeguards.

                        Metric      Grok 4.5 (high)    Grok 4.6 (high)
                        Accuracy              65.5%              67.4%


                                               31
GROK 4.6 MODEL CARD


8.2   Biosecurity VCT 30

Biosecurity VCT is an internal biosecurity companion to VCT: dual-use troubleshooting
items scored for overall accuracy (should-refuse and should-comply items together) under
the same CBRN safety-threshold framing used for VCT knowledge probes.

                         Metric     Grok 4.5 (high)    Grok 4.6 (high)
                         Accuracy             44.1%             47.8%


8.3 BioUseBench

BioUseBench is an internal high-elo dual-use biology suite of biological enablement
queries of varying difficulty and risk. We report Dual-use refusal: the refusal rate on
the highest-severity (severity-5) dual-use subset. This consists of queries that are
non-malicious but could be used in biological uplift work.

                    Metric             Grok 4.5 (high)     Grok 4.6 (high)
                    Dual-use refusal               83.3%           90.7%


8.4 WMDP dual-use knowledge (MCQ) 31

WMDP-Bio, WMDP-Chem, and WMDP-Cyber are multiple-choice suites probing
operationally sensitive dual-use knowledge in biology, chemistry, and cyber.

                Metric                     Grok 4.5 (high)    Grok 4.6 (high)
                WMDP-Bio accuracy                     90.9%              90.0%
                WMDP-Chem accuracy                    87.3%              85.3%
                WMDP-Cyber accuracy                   83.2%              90.1%


                                              32
GROK 4.6 MODEL CARD


8.5 LAB-Bench practical MCQ 32

LAB-Bench practical items test everyday wet-lab and research skills (protocol, sequence,
and cloning reasoning).

                       Metric      Grok 4.5 (high)   Grok 4.6 (high)
                       Accuracy              71.1%            80.7%


8.6 ProtocolQA Open-Ended 32

ProtocolQA open-ended asks the model to identify the single most important mistake
in a described biological lab protocol. Unlike the multiple-choice suites, this benchmark
comprises open-ended troubleshooting tasks.

                       Metric      Grok 4.5 (high)   Grok 4.6 (high)
                       Accuracy             87.0%             79.6%


8.7   BixBench zero-shot MCQ 33

BixBench evaluates computational-biology reasoning with analysis tools available by
default, scored zero-shot.

                       Metric      Grok 4.5 (high)   Grok 4.6 (high)
                       Accuracy             93.8%             93.8%

BixBench items contain no weapons-enabling content; the suite runs under Grok Build’s
default tool-on setting.


                                             33
GROK 4.6 MODEL CARD


9 Jailbreaks and robustness

We test whether Grok 4.6’s production safeguards hold under adversarial pressure.
Residual failures are treated as cases for ongoing monitoring and patching as new
techniques emerge.


9.1 Jailbreaks 34,35

We stress the refusal safeguards with a broad, continuously updated set of jailbreak
attacks, including published and internally discovered techniques, across single-turn and
multi-turn settings, as well as longer adversarial trajectories.
Compliance is the share of should-refuse attacks where the model provides disallowed
assistance. We report:

• Standard jailbreaks: a battery of varying-difficulty jailbreaks, both existing and internally
  discovered.
• StrongReject: compliance on the StrongREJECT suite.
• Long-horizon jailbreaks: multi-turn jailbreaks, Crescendo multi-turn jailbreaks, and
  malicious-use long-horizon attacks.

Lower is better.

                   Suite                     Grok 4.5 (high)   Grok 4.6 (high)
                   Standard jailbreaks               0.73%             0.04%
                   StrongReject                        1.5%             3.9%
                   Long-horizon jailbreaks                —              1.0%


                                               34
GROK 4.6 MODEL CARD


10 General output safety

This section covers policy refusals for prompts representative of consumer chat traffic
across the major disallowed categories, including dedicated CBRN and weapons refusals.
On these suites, Grok 4.6 generally refuses more reliably than Grok 4.5: lower compliance
on the broad disallowed set, improved CBRN recall, and unchanged 0.0% CSAM
compliance.
The evaluations and results below also apply to Grok Build.
Refusals are enforced by a layered, defense-in-depth stack rather than one single filter or
classifier.
Safety fine-tuning and post-training (supervised fine-tuning plus reinforcement learning
from human feedback, verifiable rewards, and model-based grading) train the model to
refuse requests that show clear intent to cause severe harm or engage in criminal activity.
System prompts further steer the model toward honesty and truth-seeking while avoiding
over-refusal on benign or hypothetical discussions.
On some deployment surfaces, Grok 4.6 is additionally augmented with runtime input and
topical filters that add controls for classes of severe harm, including CSAM, self-harm, and
biological/chemical weapons pathways, alongside cyber-specific safeguards.


10.1   General refusals

We assemble harmful queries whose intent ranges from overt to well-hidden, spanning the
major policy categories, in English and translated into Spanish, Chinese, Japanese, Arabic,
and Russian. A separate grader model judges whether the model correctly refuses.
Lower is better.

                      Metric        Grok 4.5 (high)    Grok 4.6 (high)
                      Compliance              1.10%             0.93%


                                             35
GROK 4.6 MODEL CARD


10.2 Child safety

The CSAM and child safety benchmark suite applies the shared refusal protocol to the
highest-severity child-safety category, using the same internal multi-turn suite as the prior
card.
Lower is better.

                         Metric          Grok 4.5 (high)      Grok 4.6 (high)
                         Compliance                0.00%                0.00%


10.3 CBRN / weapons refusals 36

Autointent-Bio and Autointent-Chem are internal suites of manually and synthetically
generated dangerous and benign CBRN queries; FORTRESS-RN covers radiological and
nuclear items.

          Metric                                        Grok 4.5 (high)     Grok 4.6 (high)
          Bio refusal recall                                      97.9%            100.0%
          Chem refusal recall                                     96.7%            100.0%
          FORTRESS-RN R/N refusal accuracy*                       97.9%             97.9%

CBRN pathways receive heightened scrutiny across the safeguard stack: the refusal
policy prioritizes non-assistance for biological, chemical, radiological, or nuclear
weapons development or deployment; system prompts give special attention to CBRN
misuse pathways; and dedicated input and topical filters target biological and chemical
weapons-related abuse.


*   FORTRESS-RN results are taken from evaluations conducted by Scale AI.


                                                   36
GROK 4.6 MODEL CARD


11 Mental health

We assess how Grok 4.6 handles self-harm and crisis situations. We test our models to
ensure they refuse assistance for self-harm while still providing appropriate support and
resources for users in crisis.


11.1 Self-harm refusals

The self-harm suite applies the shared refusal protocol to self-harm and crisis prompts and
longer-horizon conversations, checking that the model declines to assist while remaining
supportive. In this evaluation, a model additionally fails if it refuses without redirecting
the user to help, or if it is unable to understand the intent of a user message that implies
self-harm or crisis. A lower score is better in this benchmark.

                            Metric          Grok 4.5 (high)     Grok 4.6 (high)
                            Compliance                0.50%                0.84%


12 Behaviors

These evaluations cover propensities that affect reliability, neutrality, and controllability
rather than disallowed content: for instance, sycophancy and honesty under pressure.


12.1     MASK-Rectified 37

Using a dataset derived from MASK* , we test whether Grok 4.6 faithfully reports its beliefs
when pressured to lie, as a proxy for the model’s tendency to assert misleading information.
A lower score is better in this benchmark.

                            Metric          Grok 4.5 (high)     Grok 4.6 (high)
                            Dishonesty                0.67%                1.90%


*      MASK-Rectified corrects the MASK grading so that responses where the model is obviously (model-aware)
       role-playing, rather than asserting a genuine belief, are not counted as lies.


                                                      37
GROK 4.6 MODEL CARD


12.2   Sycophancy

Sycophancy measures the tendency to abandon a correct answer and agree with a user’s
confidently stated wrong one. We use an internal benchmark that presents the model with
a question alongside misleading user-supplied context.
Lower is better.

                      Metric       Grok 4.5 (high)   Grok 4.6 (high)
                      Sycophancy            0.01%            0.04%


                                           38
GROK 4.6 MODEL CARD


Acknowledgements

We thank our evaluation partners for running benchmarks, sharing results, and helping us
measure Grok 4.6 against real-world workloads:

• Abundant AI                  • Datacurve                    • Mercor

• Artificial Analysis          • gNucleus                     • Normal Factory

• Atopile                      • Harbor                       • Scale AI

• Cognition                    • Harvey                       • Vals AI

• Databricks                   • Mecado


                                             39
GROK 4.6 MODEL CARD


References

Public benchmarks and datasets referenced above. Superscripts mark first mention in the
main text and link to a primary source. Internal evaluations are not listed.

  1. SpaceXAI Acceptable Use Policy. https://x.ai/legal/acceptable-use-policy
 2. CursorBench 3.2. Cursor, 2026. https://cursor.com/cursorbench · https://cursor.com/blog/
    cursorbench
 3. APEX-SWE. Kottamasu et al. (Mercor), 2026. https://www.mercor.com/apex/apex-swe-
    leaderboard/ · https://arxiv.org/abs/2601.08806
 4. Terminus-2. Harbor Framework. https://www.harborframework.com/docs/agents/terminus-2
 5. FrontierCode v1.1. Cognition, 2026. https://cognition.com/frontiercode
 6. DeepSWE. Huang, Lee, Tng, and Ge (Datacurve), 2026. https://deepswe.datacurve.ai/ · https:
    //arxiv.org/abs/2607.07946
  7. mini-swe-agent. SWE-agent. https://github.com/swe-agent/mini-swe-agent
 8. SWE-Marathon. Desai et al. (Abundant AI), 2026. https://www.swe-marathon.org/ · https:
    //arxiv.org/abs/2606.07682
 9. Terminal-Bench 3.0. Merrill et al. / Harbor (Stanford & Laude Institute), 2026. https://www.
    tbench.ai/ · https://www.frontierbench.ai/ · https://arxiv.org/abs/2601.11868
 10. AA GDPVal (GDPval-AA v2). Artificial Analysis. https://artificialanalysis.ai/evaluations/gdpval-
     aa · OpenAI GDPval: Patwardhan et al., 2025. https://arxiv.org/abs/2510.04374
 11. AA-Briefcase. Artificial Analysis, 2026. https://artificialanalysis.ai/evaluations/aa-briefcase
 12. APEX-Agents. Vidgen et al. (Mercor), 2026. https://www.mercor.com/apex/apex-agents-
     leaderboard/ · https://arxiv.org/abs/2601.14242
 13. OfficeQA Pro. Opsahl-Ong et al. (Databricks), 2026. https://arxiv.org/abs/2603.08655 ·
     https://github.com/databricks/officeqa
 14. Legal Agent Benchmark (LAB / HLab). Harvey, 2026. Vals AI third-party leaderboard:
     https://www.vals.ai/benchmarks/hlab · Harvey announcement: https://www.harvey.ai/blog/
     introducing-harveys-legal-agent-benchmark
 15. Valkyrie. Vals AI agentic evaluation framework. https://github.com/vals-ai/Valkyrie · HLab on
     Valkyrie: https://www.vals.ai/benchmarks/hlab
 16. EEBench. atopile, 2026. https://eebench.org/
 17. 3DCodeBench. Gao, Shu, Ye, Xiong, Makadia, Guo, Itti, and Chen, 2026. https://arxiv.org/abs/
     2606.01057
 18. PartBench. Normal Factory, 2026. https://www.normalfactory.com/
 19. CADGenBench. Mecado / Hugging Face, 2026. https://www.mecado.com/ · https://github.
     com/huggingface/cadgenbench
20. CADBench (Parametric CAD Bench). gNucleus. https://www.gnucleus.ai/cad-bench
 21. KernelBench. Ouyang, Guo, Arora, et al. (Stanford Scaling Intelligence), 2025. https://arxiv.
     org/abs/2502.10517 · https://github.com/ScalingIntelligence/KernelBench
22. DeepSearchQA. Gupta, Chatterjee, et al., 2026. https://arxiv.org/abs/2601.20975
23. CyberGym. Wang, Shi, He, Cai, Zhang, and Song, 2025. https://www.cybergym.io/ · https:
    //arxiv.org/abs/2506.02548


                                                 40
GROK 4.6 MODEL CARD


24. Claude Fable 5 & Mythos 5 System Card. Anthropic, 2026. https://www.anthropic.com/
    claude-fable-5-mythos-5-system-card
25. GPT-5.6 System Card. OpenAI, 2026. https://deploymentsafety.openai.com/gpt-5-6
26. Claude Opus 4.8 System Card. Anthropic, 2026. https://www.anthropic.com/claude-opus-4-
    8-system-card
27. GPT-5.5 System Card. OpenAI, 2026. https://deploymentsafety.openai.com/gpt-5-5
28. CVE-Bench. Zhu et al., 2025. https://arxiv.org/abs/2503.17332
29. xAI Frontier Artificial Intelligence Framework (FAIF). xAI, June 30, 2026. https://media.x.ai/v1/
    website/xai-frontier-artificial-intelligence-framework-30-june-2026-99c40684.pdf
30. VCT. Götting, Medeiros, Sanders, Li, Phan, Elabd, Justen, Hendrycks, and Donoughe, 2025.
    https://arxiv.org/abs/2504.16137
 31. WMDP. Li et al., 2024. https://wmdp.ai · https://arxiv.org/abs/2403.03218
32. LAB-Bench. Laurent et al., 2024. https://github.com/Future-House/LAB-Bench · https://
    arxiv.org/abs/2407.10362
33. BixBench. Mitchener, Laurent, et al., 2025. https://github.com/Future-House/BixBench ·
    https://arxiv.org/abs/2503.00096
34. StrongREJECT. Souly et al., 2024. https://arxiv.org/abs/2402.10260
35. Crescendo multi-turn jailbreak. Russinovich, Salem, and Eldan (Microsoft), 2024. https://arxiv.
    org/abs/2404.01833
36. FORTRESS. Knight, Deshpande, et al. (Scale AI), 2025. https://labs.scale.com/leaderboard/
    fortress · https://arxiv.org/abs/2506.14922
37. MASK. Ren et al., 2025. https://www.mask-benchmark.ai/ · https://arxiv.org/abs/2503.
    03750


                                                 41
