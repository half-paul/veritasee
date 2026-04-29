I want to create a **Human-Centric Truth Layer** with an autonomous AI system. The platform acts as a community-governed "correction overlay" for any online encyclopedia.

---

## 1. Product Overview: "Veritasee Override"
**Goal:** To provide a decentralized, collaborative fact-checking environment where humans author corrections and scores, supported by AI verification tools.

---

## 2. Core Features & Functional Requirements

### **A. Multi-Source Proxy Viewer**
* **Universal URL Entry:** A main dashboard input where users paste a URL (e.g., Wikipedia, Britannica, Citizendium).
* **The "Override" Frame:** The platform loads the target site within a secure frame. It parses the site's DOM to allow users to click on specific paragraphs or sections to initiate a fact-check.
* **Cross-Domain Support:** Must support non-MediaWiki structures by using generic HTML scrapers to identify text blocks.

### **B. Human-Led Correction Engine**
* **Manual Correction Editor:** A side-by-side text editor where users write a rebuttal or correction for a specific section.
* **Granular Scoring:** Humans assign a **Verity Score ($0-100\%$)** to the selected section based on their research.
* **Reference Management:** Humans must link at least one primary source (non-encyclopedia) to support their correction.

### **C. AI Verification Toolset (Agent-on-Demand)**
* **"Verify with AI" Button:** A tool available within the editor. It does **not** write the content but performs a high-speed search across academic and historical databases to present supporting/contradicting evidence to the human.
* **Draft Generation:** Optional AI feature to summarize the found evidence into a draft, which the human **must** edit and approve before submission.

### **D. Content Governance (Human-in-the-Loop)**
* **Draft Status:** All new corrections are marked as `Draft`.
* **Approval Workflow:** A "Moderator" or "Peer Reviewer" must verify the human's correction and the AI-gathered evidence.
* **Publication:** Only `Approved` content is visible as the primary "Override" for other users.

---

## 3. User & Membership Management

### **A. Role-Based Access Control (RBAC)**
| Role | Permissions |
| :--- | :--- |
| **Reader** | Can view fact-checks and the "Verity Score." No registration required. |
| **Contributor** | Can write corrections and use AI tools. Requires registration. |
| **Moderator** | Can Approve/Reject Contributor submissions. Assigned based on reputation. |
| **Admin** | Manages users and platform-wide configurations. |

### **B. Reputation System**
* Users gain "Trust Points" when their corrections are approved by moderators.
* High-reputation contributors can eventually auto-approve their own minor edits.

---

## 4. Usage Constraints & Limits
* **Background Analysis Limit:** Users are limited to **10 background article analyses per day**. 
* **Logic:** This "Background Analysis" refers to the deep AI-scraping and cross-referencing process.
* **Technical Implementation:** * Tracked via `user_id` in a daily Redis counter.
    * Once the limit is hit, the "Verify with AI" button is disabled until the next UTC day.

---
