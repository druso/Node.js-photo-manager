---
description: Weekly Security Review and Documentation Update
auto_execution_mode: 1
---

### Task: Weekly Security Review and Documentation Update

Your role is to perform a weekly security assessment of the application and update the **`security.md`** document. This is a critical process to maintain the security posture of the application, ensuring that new developments are reviewed and that security principles are consistently upheld.

---

### Phase 1: Security Assessment and Verification

First, review the new notes added by developers at the end of the **`security.md`** file. Then, proceed with a hands-on review of the codebase to verify the solidity of their implementations. Your assessment should focus on the following:

* **Codebase Verification:** For each new note in the `security.md` file, examine the corresponding code changes. Verify that the security measures are correctly implemented and follow best practices. Look for common vulnerabilities such as SQL injection, Cross-Site Scripting (XSS), insecure direct object references, or misconfigured access controls.
* **New Vulnerabilities:** Independently assess any new features or functions introduced since the last review. Identify potential security risks or new vulnerabilities that may not have been noted by the developers.
* **Documentation Review:** Analyze the following documents for potential security risks: **`PROJECT_OVERVIEW.md`**, **`SCHEMA_DOCUMENTATION.md`**, **`JOBS_OVERVIEW.md`**, and **`README.md`**. Look for design choices, data handling practices, or operational instructions that could pose a security threat. For instance, does the schema documentation expose sensitive data fields? Does the jobs overview reveal a weak authentication method?
* **Review of Finalized Work:** Check for any security-related development tasks that have been marked as "completed" in the priority list. Conduct a final review of these implementations to ensure they are robust and have no lingering issues.

---

### Phase 2: Documentation and Prioritization

After your assessment, you will update the **`security.md`** document to reflect your findings and adjust the team's security priorities.

* **Integrate Findings:** Review the notes at the end of the document. If a developer's note has been addressed and the code is secure, finalize and integrate it into the main body of the document, ensuring the information is clear and well-organized. If an issue is found, add a detailed explanation of the problem to the document.
* **Update Priority List:** Based on your review of new functions, documentation, and finalized work, update the prioritized list at the top of the **`security.md`** file.
    * **Add new items:** For any new vulnerabilities or necessary security improvements you've identified, add them to the top of the list with a clear description and a priority level.
    * **Remove completed items:** Once a prioritized task is verified as complete and secure, remove it from the list.
* **Keep it Concise:** Ensure the **`security.md`** document remains a living, actionable record. Remove outdated information and consolidate notes to keep the document concise and easy to navigate.

**Deliverable:**

Commit your changes directly to the **`SECURITY.md`** file. Your commit message should clearly summarize the updates (e.g., "SEC: Weekly security review, finalized XSS fix, and added new priority for API endpoint validation").