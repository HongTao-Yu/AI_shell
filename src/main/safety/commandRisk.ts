import type { CommandRiskAnalysis, CommandSuggestion } from "../../shared/types";

const lowRiskPatterns: Array<[RegExp, string]> = [
  [/^\s*ls(\s|$)/, "Directory listing command."],
  [/^\s*pwd\s*$/, "Prints the current working directory."],
  [/^\s*cat\s+(?!.*(^|\s)(\/etc\/shadow|.*id_rsa|.*\.env)(\s|$)).+/, "Reads a regular file."],
  [/^\s*grep(\s|$)/, "Searches text content."],
  [/^\s*find(\s|$)/, "Finds files or directories."],
  [/^\s*which(\s|$)/, "Locates an executable."],
  [/^\s*uname(\s|$)/, "Reads system kernel information."],
  [/^\s*whoami\s*$/, "Prints the current username."],
  [/^\s*printf\s+'%s'\s+"\$\{shell:-unknown\}"\s*$/, "Prints shell information."],
  [/^\s*git\s+branch\s+--show-current\b/, "Reads the current Git branch."],
  [/^\s*git\s+status\s+--short\b/, "Reads short Git working tree status."],
  [/^\s*(\[\s+-e\s+'[^']+'\s+\]\s+&&\s+printf\s+'%s\\n'\s+'[^']+'\s*;?\s*)+(;\s*true)?\s*$/, "Checks whether known project marker files exist."],
  [/^\s*python\d*\s+--version\s*$/, "Checks Python version."],
  [/^\s*java\s+-version\s*$/, "Checks Java version."],
  [/^\s*df\s+-h\s*$/, "Checks disk usage."],
  [/^\s*du\s+.*$/, "Queries disk usage."]
];

const mediumRiskPatterns: Array<[RegExp, string]> = [
  [/\bapt\s+install\b/, "Installs packages with apt."],
  [/\byum\s+install\b/, "Installs packages with yum."],
  [/\bdnf\s+install\b/, "Installs packages with dnf."],
  [/\bpip\d*\s+install\b/, "Installs Python packages."],
  [/\bnpm\s+install\b/, "Installs Node.js dependencies."],
  [/\bdocker\s+pull\b/, "Downloads a Docker image."],
  [/\bsystemctl\s+start\b/, "Starts a system service."],
  [/\bsystemctl\s+restart\b/, "Restarts a system service."]
];

const highRiskPatterns: Array<[RegExp, string]> = [
  [/\brm\s+(-[^\s]*r[^\s]*f|-+[^\s]*f[^\s]*r)\s+(?!\/(?:\s|$)|\/\*(?:\s|$))\S+/, "Recursively deletes a non-empty path."],
  [/\bchmod\s+-R\s+777\b/, "Recursively grants world-writable permissions."],
  [/\bchown\s+-R\b/, "Recursively changes file ownership."],
  [/\bkill\s+-9\b/, "Force-kills a process."],
  [/\bsystemctl\s+stop\b/, "Stops a system service."],
  [/\bsystemctl\s+disable\b/, "Disables a system service."],
  [/\bdocker\s+system\s+prune\b/, "Removes unused Docker data."],
  [/\bkubectl\s+delete\b/, "Deletes Kubernetes resources."],
  [/\bapt\s+remove\b/, "Removes packages with apt."],
  [/\byum\s+remove\b/, "Removes packages with yum."],
  [/\bpip\d*\s+uninstall\b/, "Uninstalls Python packages."],
  [/\bcurl\b.+\|\s*bash\b/, "Downloads and pipes a remote script to bash."],
  [/\bwget\b.+\|\s*sh\b/, "Downloads and pipes a remote script to sh."]
];

const blockedRiskPatterns: Array<[RegExp, string]> = [
  [/\brm\s+(-[^\s]*r[^\s]*f|-+[^\s]*f[^\s]*r)\s+\/(?:\s|$)/, "Attempts to recursively delete the filesystem root."],
  [/\brm\s+(-[^\s]*r[^\s]*f|-+[^\s]*f[^\s]*r)\s+\/\*(?:\s|$)/, "Attempts to recursively delete root directory contents."],
  [/\bmkfs(?:\s|$)/, "Formats a filesystem."],
  [/\bdd\s+if=/, "Uses dd with an input device or image."],
  [/\bfdisk(?:\s|$)/, "Edits disk partitions."],
  [/\bparted(?:\s|$)/, "Edits disk partitions."],
  [/>+\s*\/dev\/sda(?:\s|$)/, "Writes directly to /dev/sda."],
  [/:\(\)\{\s*:\|:&\s*\};:/, "Matches a fork bomb pattern."]
];

function collectReasons(command: string, patterns: Array<[RegExp, string]>): string[] {
  return patterns.filter(([pattern]) => pattern.test(command)).map(([, reason]) => reason);
}

export function analyzeCommandRisk(command: string): CommandRiskAnalysis {
  const normalizedCommand = command.trim().toLowerCase();

  if (!normalizedCommand) {
    return {
      level: "blocked",
      reasons: ["Empty commands cannot be executed."],
      requiresSecondConfirm: false
    };
  }

  const blockedReasons = collectReasons(normalizedCommand, blockedRiskPatterns);
  if (blockedReasons.length > 0) {
    return {
      level: "blocked",
      reasons: blockedReasons,
      requiresSecondConfirm: false
    };
  }

  const highReasons = collectReasons(normalizedCommand, highRiskPatterns);
  if (highReasons.length > 0) {
    return {
      level: "high",
      reasons: highReasons,
      requiresSecondConfirm: true
    };
  }

  const mediumReasons = collectReasons(normalizedCommand, mediumRiskPatterns);
  if (mediumReasons.length > 0) {
    return {
      level: "medium",
      reasons: mediumReasons,
      requiresSecondConfirm: false
    };
  }

  const lowReasons = collectReasons(normalizedCommand, lowRiskPatterns);
  if (lowReasons.length > 0) {
    return {
      level: "low",
      reasons: lowReasons,
      requiresSecondConfirm: false
    };
  }

  return {
    level: "medium",
    reasons: ["Command is not recognized as a safe read-only command, so it is treated conservatively."],
    requiresSecondConfirm: false
  };
}

export function applyRiskToSuggestion(suggestion: CommandSuggestion): CommandSuggestion {
  const analysis = analyzeCommandRisk(suggestion.command);

  return {
    ...suggestion,
    riskLevel: analysis.level,
    blocked: analysis.level === "blocked",
    blockReason: analysis.level === "blocked" ? analysis.reasons.join(" ") : suggestion.blockReason
  };
}
