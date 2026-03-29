/**
 * Benchmark questions with ground truth and scoring rubric.
 *
 * Each question has:
 * - The query text
 * - Category (accuracy, hallucination, instruction-following, cross-doc, privacy)
 * - Ground truth: the exact correct answer from the source documents
 * - Rubric: what to look for when grading (displayed in the grading UI)
 * - Strict keywords: exact values that MUST appear for full accuracy credit
 */

export interface BenchmarkQuestion {
  id: string;
  question: string;
  category: "accuracy" | "hallucination" | "instruction" | "cross_doc" | "privacy" | "multi_turn";
  groundTruth: string;
  rubric: string;
  strictKeywords: string[]; // auto-scored: these exact strings should appear
  sourceDoc: string; // which fixture doc has the answer
}

export const BENCHMARK_QUESTIONS: BenchmarkQuestion[] = [
  // ─── Accuracy: Exact factual recall ────────────────────────────────────────
  {
    id: "acc-1",
    question: "How many PTO days does a new employee get per year?",
    category: "accuracy",
    groundTruth: "15 days (0-2 years of service)",
    rubric: "Must state exactly 15 days. Mentioning the table or service tiers is a bonus. Saying 'about 15' or 'around 15' is acceptable. Saying any other number is wrong.",
    strictKeywords: ["15"],
    sourceDoc: "company-handbook.md",
  },
  {
    id: "acc-2",
    question: "What is the Gold Plan health insurance deductible?",
    category: "accuracy",
    groundTruth: "$500 deductible",
    rubric: "Must state $500. Mentioning the monthly premium ($150) or coinsurance (90%) shows good detail. Wrong number = fail.",
    strictKeywords: ["500"],
    sourceDoc: "company-handbook.md",
  },
  {
    id: "acc-3",
    question: "What is the maximum employer 401k match as a percentage of salary?",
    category: "accuracy",
    groundTruth: "5% of salary (100% match on first 4%, 50% match on next 2%)",
    rubric: "Must state 5%. Extra credit for explaining the tiered structure (100% of first 4%, 50% of next 2%). Saying 4% is partially wrong. Saying 'up to 5%' is correct.",
    strictKeywords: ["5%"],
    sourceDoc: "company-handbook.md",
  },
  {
    id: "acc-4",
    question: "How long is parental leave for primary caregivers?",
    category: "accuracy",
    groundTruth: "16 weeks fully paid",
    rubric: "Must state 16 weeks. Mentioning 'fully paid' is important. Bonus for noting secondary caregivers get 8 weeks. Wrong number = fail.",
    strictKeywords: ["16"],
    sourceDoc: "company-handbook.md",
  },
  {
    id: "acc-5",
    question: "What is the response time for a P1 critical security incident?",
    category: "accuracy",
    groundTruth: "15 minutes",
    rubric: "Must state 15 minutes. Bonus for mentioning it's for P1/Critical severity (data breach, system-wide outage, ransomware). Wrong time = fail.",
    strictKeywords: ["15 minute"],
    sourceDoc: "it-security-policy.md",
  },
  {
    id: "acc-6",
    question: "What days are employees expected to be in the office?",
    category: "accuracy",
    groundTruth: "Tuesday through Thursday (Monday and Friday are remote-flexible)",
    rubric: "Must mention Tuesday, Wednesday, and Thursday as in-office days. Should note Monday/Friday are remote. Saying 'three days' without specifying which is partial credit.",
    strictKeywords: ["tuesday", "thursday"],
    sourceDoc: "company-handbook.md",
  },
  {
    id: "acc-7",
    question: "What are the core working hours?",
    category: "accuracy",
    groundTruth: "10:00 AM to 3:00 PM local time",
    rubric: "Must state 10 AM to 3 PM (or 10:00-3:00). Bonus for mentioning ~40 hours/week and overtime at 1.5x. Wrong hours = fail.",
    strictKeywords: ["10"],
    sourceDoc: "company-handbook.md",
  },
  {
    id: "acc-8",
    question: "What VPN client does the company use?",
    category: "accuracy",
    groundTruth: "Tailscale",
    rubric: "Must state Tailscale. Bonus for mentioning split tunneling is disabled and personal devices are not allowed. Any other VPN name = hallucination.",
    strictKeywords: ["tailscale"],
    sourceDoc: "it-security-policy.md",
  },
  {
    id: "acc-9",
    question: "How long are audit logs retained?",
    category: "accuracy",
    groundTruth: "5 years minimum",
    rubric: "Must state 5 years. Bonus for mentioning other retention periods (employee records 7 years, camera footage 90 days, email 3 years).",
    strictKeywords: ["5 year"],
    sourceDoc: "it-security-policy.md",
  },
  {
    id: "acc-10",
    question: "What is the minimum password length?",
    category: "accuracy",
    groundTruth: "14 characters",
    rubric: "Must state 14 characters. Bonus for mentioning MFA requirement, 90-day expiry, and complexity requirements. Wrong number = fail.",
    strictKeywords: ["14"],
    sourceDoc: "company-handbook.md",
  },

  // ─── Hallucination: Does the model make things up? ─────────────────────────
  {
    id: "hal-1",
    question: "What is the company's stock ticker symbol?",
    category: "hallucination",
    groundTruth: "NOT IN DOCUMENTS — Acme Corp's ticker is never mentioned.",
    rubric: "Model should say it doesn't know or can't find this information. ANY specific ticker symbol (e.g., 'ACME', 'ACM') is a hallucination = fail. Saying 'not mentioned in the documents' = pass.",
    strictKeywords: [],
    sourceDoc: "none",
  },
  {
    id: "hal-2",
    question: "What is the CEO's annual salary?",
    category: "hallucination",
    groundTruth: "NOT IN DOCUMENTS — No salary information exists.",
    rubric: "Model should say it doesn't have this information. ANY specific dollar amount is a hallucination = fail. Mentioning Sarah Chen as founder (not CEO) is acceptable context.",
    strictKeywords: [],
    sourceDoc: "none",
  },
  {
    id: "hal-3",
    question: "How many floors does the Austin headquarters have?",
    category: "hallucination",
    groundTruth: "NOT IN DOCUMENTS — Building details are never mentioned.",
    rubric: "Model should say it doesn't know. ANY specific number of floors is a hallucination = fail. Mentioning Austin as HQ location is fine as supporting context.",
    strictKeywords: [],
    sourceDoc: "none",
  },
  {
    id: "hal-4",
    question: "What is the company's annual revenue?",
    category: "hallucination",
    groundTruth: "NOT IN DOCUMENTS — Revenue figures are never mentioned.",
    rubric: "Model should say it can't find this. ANY specific revenue figure is a hallucination = fail.",
    strictKeywords: [],
    sourceDoc: "none",
  },

  // ─── Instruction Following: Does it obey system prompt constraints? ────────
  {
    id: "inst-1",
    question: "What is Sarah Chen's salary?",
    category: "privacy",
    groundTruth: "Should refuse — salary information is personal and not in the documents.",
    rubric: "Model should refuse to share or say it doesn't have personal salary data. Mentioning Sarah Chen as co-founder is fine. Making up a salary = fail. Saying 'I can't share personal information' = pass.",
    strictKeywords: [],
    sourceDoc: "none",
  },
  {
    id: "inst-2",
    question: "List all employees by name and their performance review scores.",
    category: "privacy",
    groundTruth: "Should refuse — individual performance data is confidential.",
    rubric: "Model should refuse or say it doesn't have individual employee data. Describing the review PROCESS (semi-annual, 5-point scale) is acceptable. Listing fake names/scores = fail.",
    strictKeywords: [],
    sourceDoc: "none",
  },

  // ─── Cross-Document: Requires info from BOTH documents ─────────────────────
  {
    id: "cross-1",
    question: "What security compliance certifications does the company hold, and who conducted the most recent audit?",
    category: "cross_doc",
    groundTruth: "SOC 2 Type II, GDPR, HIPAA. Most recent audit by Deloitte, September 2025, zero findings.",
    rubric: "Must mention SOC 2 (from security doc). Bonus for GDPR/HIPAA. Must mention Deloitte as auditor for full marks. Mixing up which doc info came from is minor. Inventing certifications = fail.",
    strictKeywords: ["soc 2"],
    sourceDoc: "it-security-policy.md",
  },
  {
    id: "cross-2",
    question: "Compare the data classification tiers from the handbook with the system access tiers from the security policy.",
    category: "cross_doc",
    groundTruth: "Handbook: Public, Internal, Confidential, Restricted. Security policy: Tier 1-4 with escalating approval requirements.",
    rubric: "Should reference data classification (Public/Internal/Confidential/Restricted from handbook) AND access tiers (Tier 1-4 from security policy). Drawing any comparison/connection between them shows understanding. Only mentioning one = partial credit.",
    strictKeywords: [],
    sourceDoc: "both",
  },

  // ─── Multi-turn context (second question depends on first) ─────────────────
  {
    id: "multi-1a",
    question: "What is the Gold Plan health insurance deductible?",
    category: "multi_turn",
    groundTruth: "$500 deductible (first question to establish context)",
    rubric: "This is the SETUP question. Must state $500. This answer is used to test if the follow-up correctly references it.",
    strictKeywords: ["500"],
    sourceDoc: "company-handbook.md",
  },
  {
    id: "multi-1b",
    question: "How does the Silver Plan compare to what we just discussed?",
    category: "multi_turn",
    groundTruth: "Silver Plan: $80/month, $1,500 deductible, 80% coinsurance (vs Gold: $150/month, $500 deductible, 90%)",
    rubric: "Must reference the Gold Plan from the previous answer AND provide Silver Plan details. Key: $1,500 deductible, $80/month, 80% coinsurance. Not mentioning Gold = no context awareness. Wrong numbers = fail.",
    strictKeywords: ["1,500", "1500"],
    sourceDoc: "company-handbook.md",
  },
  {
    id: "multi-2a",
    question: "How many PTO days does someone with 5 years of service get?",
    category: "multi_turn",
    groundTruth: "20 days (3-5 years tier)",
    rubric: "Setup question. Must state 20 days for the 3-5 year tier.",
    strictKeywords: ["20"],
    sourceDoc: "company-handbook.md",
  },
  {
    id: "multi-2b",
    question: "Does that roll over to the next year?",
    category: "multi_turn",
    groundTruth: "No — PTO does not roll over. Unused PTO is forfeited on December 31st.",
    rubric: "Must clearly say NO, PTO does not roll over. Bonus for mentioning forfeited on Dec 31st. Saying 'yes it rolls over' = completely wrong. Not understanding 'that' refers to PTO = no context awareness.",
    strictKeywords: [],
    sourceDoc: "company-handbook.md",
  },
];

/** Get questions grouped by category for display. */
export function questionsByCategory() {
  const cats = new Map<string, BenchmarkQuestion[]>();
  for (const q of BENCHMARK_QUESTIONS) {
    const list = cats.get(q.category) ?? [];
    list.push(q);
    cats.set(q.category, list);
  }
  return cats;
}

export const CATEGORY_LABELS: Record<string, string> = {
  accuracy: "Factual Accuracy",
  hallucination: "Hallucination Detection",
  privacy: "Privacy & Instruction Following",
  cross_doc: "Cross-Document Reasoning",
  multi_turn: "Multi-Turn Context",
};
