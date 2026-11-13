package com.ainative.common.security;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Policy & guardrails: masks secrets/PII, blocks forbidden input, controls which tools may run. */
public class PolicyGuardrails {
    public record CheckResult(boolean allowed, List<String> reasons) {
        static CheckResult ok() { return new CheckResult(true, List.of()); }
    }

    private static final List<Pattern> SECRET_PATTERNS = List.of(
            Pattern.compile("\\bsk-[A-Za-z0-9_-]{16,}\\b"),            // OpenAI / Anthropic style keys
            Pattern.compile("\\bAIza[0-9A-Za-z_-]{30,}\\b"),           // Google API keys
            Pattern.compile("\\bgh[pousr]_[A-Za-z0-9]{20,}\\b"),       // GitHub tokens
            Pattern.compile("\\bAKIA[0-9A-Z]{16}\\b"),                 // AWS access key ids
            Pattern.compile("\\bxox[abpr]-[A-Za-z0-9-]{10,}\\b"),      // Slack tokens
            Pattern.compile("-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----"));
    private static final Pattern KEY_VALUE =
            Pattern.compile("\\b(password|passwd|pwd|secret|api[_-]?key|token)\\s*[:=]\\s*[\"']?[^\\s\"']{4,}", Pattern.CASE_INSENSITIVE);
    private static final Pattern EMAIL = Pattern.compile("\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b");

    private final List<Pattern> extraSecrets = new ArrayList<>();
    private final List<Pattern> blocked = new ArrayList<>();
    private List<String> allowedTools; // null = all allowed
    private final List<String> deniedTools = new ArrayList<>();
    private boolean maskEmails = true;

    public PolicyGuardrails addSecretPattern(String regex) { extraSecrets.add(Pattern.compile(regex)); return this; }
    public PolicyGuardrails blockPattern(String regex) { blocked.add(Pattern.compile(regex, Pattern.CASE_INSENSITIVE)); return this; }
    public PolicyGuardrails allowOnlyTools(List<String> names) { allowedTools = List.copyOf(names); return this; }
    public PolicyGuardrails denyTool(String name) { deniedTools.add(name); return this; }
    public PolicyGuardrails maskEmails(boolean on) { maskEmails = on; return this; }

    /** Replaces secrets (and e-mails) with "xxxx". */
    public String redact(String text) {
        String out = text;
        for (Pattern p : SECRET_PATTERNS) out = p.matcher(out).replaceAll("xxxx");
        for (Pattern p : extraSecrets) out = p.matcher(out).replaceAll("xxxx");
        out = KEY_VALUE.matcher(out).replaceAll(m -> Matcher.quoteReplacement(m.group(1) + "=xxxx"));
        if (maskEmails) out = EMAIL.matcher(out).replaceAll("xxxx");
        return out;
    }

    public CheckResult checkInput(String text) {
        List<String> reasons = blocked.stream().filter(p -> p.matcher(text).find()).map(p -> "Blocked pattern: " + p.pattern()).toList();
        return new CheckResult(reasons.isEmpty(), reasons);
    }

    public CheckResult checkTool(String name) {
        if (deniedTools.contains(name)) return new CheckResult(false, List.of("Tool denied by policy: " + name));
        if (allowedTools != null && !allowedTools.contains(name)) return new CheckResult(false, List.of("Tool not in allow-list: " + name));
        return CheckResult.ok();
    }
}
