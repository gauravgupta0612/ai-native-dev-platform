package com.ainative.common.router;

/** Send requests for a task (e.g. "code-generation") to a given provider, optionally a given model. */
public record RouteRule(String task, String provider, String model) {
    public RouteRule(String task, String provider) { this(task, provider, null); }
}
