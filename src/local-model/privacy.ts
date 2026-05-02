import type { PrivacyPolicyMode } from "../shared/types";

export type SensitiveLabel = "email" | "phone" | "address" | "token" | "credential" | "financial" | "personal" | "unknown";
export type PrivacyRisk = "low" | "medium" | "high";
export type PrivacyAction = "allow" | "redact" | "block" | "ask";

export type SensitiveSpan = {
  id: string;
  label: SensitiveLabel;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: "rule" | "local-model";
  action: PrivacyAction;
};

export type PrivacyScanResult = {
  hasSensitiveData: boolean;
  maxRisk: PrivacyRisk;
  spans: SensitiveSpan[];
  recommendedAction: PrivacyAction;
};

export type AppliedPrivacyPolicy = {
  action: PrivacyAction;
  text: string;
  scan: PrivacyScanResult;
};

type PatternRule = {
  label: SensitiveLabel;
  risk: PrivacyRisk;
  confidence: number;
  pattern: RegExp;
};

const rules: PatternRule[] = [
  {
    label: "email",
    risk: "medium",
    confidence: 0.95,
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    label: "token",
    risk: "high",
    confidence: 0.98,
    pattern: /\b(?:Bearer\s+)?(?:sk|pk|ghp|gho|xoxb|xoxp|AIza)[A-Za-z0-9._:-]{12,}\b/g
  },
  {
    label: "credential",
    risk: "high",
    confidence: 0.9,
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^"'\s]{6,}/gi
  },
  {
    label: "financial",
    risk: "high",
    confidence: 0.85,
    pattern: /\b(?:\d[ -]*?){13,19}\b/g
  },
  {
    label: "phone",
    risk: "medium",
    confidence: 0.75,
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g
  },
  {
    label: "address",
    risk: "medium",
    confidence: 0.7,
    pattern: /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b/gi
  }
];

function riskRank(risk: PrivacyRisk): number {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

function actionForRisk(risk: PrivacyRisk): PrivacyAction {
  if (risk === "high") return "block";
  if (risk === "medium") return "redact";
  return "allow";
}

function dedupeOverlaps(spans: SensitiveSpan[]): SensitiveSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || riskRank(b.action === "block" ? "high" : "medium") - riskRank(a.action === "block" ? "high" : "medium"));
  const selected: SensitiveSpan[] = [];
  for (const span of sorted) {
    if (selected.some((existing) => span.start < existing.end && span.end > existing.start)) continue;
    selected.push(span);
  }
  return selected;
}

export function scanSensitiveText(text: string): PrivacyScanResult {
  const spans: SensitiveSpan[] = [];

  for (const rule of rules) {
    for (const match of text.matchAll(rule.pattern)) {
      const matched = match[0];
      if (!matched || match.index === undefined) continue;
      spans.push({
        id: `${rule.label}-${match.index}-${match.index + matched.length}`,
        label: rule.label,
        text: matched,
        start: match.index,
        end: match.index + matched.length,
        confidence: rule.confidence,
        source: "rule",
        action: actionForRisk(rule.risk)
      });
    }
  }

  const deduped = dedupeOverlaps(spans);
  const maxRisk = deduped.reduce<PrivacyRisk>((current, span) => {
    const risk: PrivacyRisk = span.action === "block" ? "high" : span.action === "redact" ? "medium" : "low";
    return riskRank(risk) > riskRank(current) ? risk : current;
  }, "low");

  return {
    hasSensitiveData: deduped.length > 0,
    maxRisk,
    spans: deduped,
    recommendedAction: actionForRisk(maxRisk)
  };
}

export function redactText(text: string, spans: SensitiveSpan[]): string {
  return [...spans]
    .sort((a, b) => b.start - a.start)
    .reduce((current, span) => `${current.slice(0, span.start)}[${span.label}:redacted]${current.slice(span.end)}`, text);
}

export function applyPrivacyPolicy(text: string, options: { mode: PrivacyPolicyMode }): AppliedPrivacyPolicy {
  const scan = scanSensitiveText(text);
  if (!scan.hasSensitiveData || options.mode === "off") {
    return { action: "allow", text, scan };
  }
  if (options.mode === "block" && scan.maxRisk === "high") {
    return { action: "block", text, scan };
  }
  if (options.mode === "ask" && scan.recommendedAction !== "allow") {
    return { action: "ask", text, scan };
  }
  if (options.mode === "redact" || options.mode === "block") {
    return { action: "redact", text: redactText(text, scan.spans), scan };
  }
  return { action: "allow", text, scan };
}
