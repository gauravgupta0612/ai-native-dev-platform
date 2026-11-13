package com.ainative.common.router;

/** Per-request routing hints. {@code sensitive} forces the local provider (data never leaves the machine). */
public record RouteOptions(String task, boolean sensitive) {
    public static final RouteOptions NONE = new RouteOptions(null, false);

    public static RouteOptions task(String task) { return new RouteOptions(task, false); }
    public static RouteOptions sensitiveOnly() { return new RouteOptions(null, true); }
}
