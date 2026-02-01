export interface SecretFinding {
  type: string;
  line: number;
  column: number;
  match: string;
  entropy?: number;
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "AWS Secret Key", pattern: /[A-Za-z0-9/+=]{40}/g },
  { name: "GitHub Token", pattern: /ghp_[A-Za-z0-9]{36}/g },
  { name: "GitHub OAuth", pattern: /gho_[A-Za-z0-9]{36}/g },
  { name: "GitHub App Token", pattern: /ghu_[A-Za-z0-9]{36}/g },
  { name: "GitHub Refresh Token", pattern: /ghr_[A-Za-z0-9]{36}/g },
  { name: "GitLab Token", pattern: /glpat-[A-Za-z0-9\-_]{20,}/g },
  { name: "Slack Token", pattern: /xox[baprs]-[A-Za-z0-9\-]+/g },
  { name: "Slack Webhook", pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g },
  { name: "OpenAI Key", pattern: /sk-[A-Za-z0-9]{48}/g },
  { name: "Stripe Key", pattern: /sk_live_[A-Za-z0-9]{24,}/g },
  { name: "Stripe Test Key", pattern: /sk_test_[A-Za-z0-9]{24,}/g },
  { name: "Private Key", pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: "Generic API Key", pattern: /['"](api[_-]?key|apikey|api[_-]?secret)['"]\s*[:=]\s*['"][A-Za-z0-9\-_]{20,}['"]/gi },
];

function calculateEntropy(str: string): number {
  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }
  
  let entropy = 0;
  const len = str.length;
  const values = Array.from(freq.values());
  for (const count of values) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  
  return entropy;
}

function findHighEntropyStrings(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split("\n");
  
  const highEntropyPattern = /[A-Za-z0-9+/=_\-]{32,}/g;
  
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    let match: RegExpExecArray | null;
    
    while ((match = highEntropyPattern.exec(line)) !== null) {
      const str = match[0];
      const entropy = calculateEntropy(str);
      
      if (entropy > 4.5 && str.length >= 32) {
        const lowerStr = str.toLowerCase();
        if (!lowerStr.includes("aaaa") && 
            !lowerStr.includes("0000") && 
            !/^[a-z]+$/.test(lowerStr) &&
            !/^[0-9]+$/.test(str)) {
          findings.push({
            type: "High Entropy String",
            line: lineNum + 1,
            column: match.index + 1,
            match: str.slice(0, 20) + "...",
            entropy
          });
        }
      }
    }
  }
  
  return findings;
}

export function scanForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split("\n");
  
  for (const { name, pattern } of SECRET_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, "g");
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      let match: RegExpExecArray | null;
      
      while ((match = globalPattern.exec(line)) !== null) {
        findings.push({
          type: name,
          line: lineNum + 1,
          column: match.index + 1,
          match: match[0].slice(0, 20) + (match[0].length > 20 ? "..." : "")
        });
      }
    }
  }
  
  const entropyFindings = findHighEntropyStrings(content);
  findings.push(...entropyFindings);
  
  return findings;
}

export function maskSecret(secret: string, visibleChars = 4): string {
  if (secret.length <= visibleChars * 2) {
    return "*".repeat(secret.length);
  }
  return secret.slice(0, visibleChars) + "*".repeat(secret.length - visibleChars * 2) + secret.slice(-visibleChars);
}
