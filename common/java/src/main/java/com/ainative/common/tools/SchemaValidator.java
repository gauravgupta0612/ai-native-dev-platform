package com.ainative.common.tools;

import com.ainative.common.json.Json;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Lightweight JSON-Schema checker for tool arguments (type, required, enum, lengths, ranges, nesting). */
public final class SchemaValidator {
    private SchemaValidator() {}

    /** Returns a list of problems (empty list = valid). */
    public static List<String> validate(Map<String, Object> schema, Object value) {
        List<String> errors = new ArrayList<>();
        check(schema, value, "args", errors);
        return errors;
    }

    private static boolean typeOk(String type, Object v) {
        return switch (type) {
            case "object" -> v instanceof Map;
            case "array" -> v instanceof List;
            case "string" -> v instanceof String;
            case "integer" -> v instanceof Integer || v instanceof Long || (v instanceof Double d && d == Math.rint(d));
            case "number" -> v instanceof Number;
            case "boolean" -> v instanceof Boolean;
            case "null" -> v == null;
            default -> true;
        };
    }

    private static void check(Map<String, Object> schema, Object value, String path, List<String> errors) {
        if (schema == null) return;
        String type = schema.get("type") instanceof String t ? t : null;
        if (type != null && !typeOk(type, value)) { errors.add(path + ": expected " + type); return; }
        if (schema.get("enum") instanceof List<?> en && !en.contains(value)) errors.add(path + ": must be one of " + en);
        if (value instanceof String s) {
            if (schema.get("minLength") instanceof Number n && s.length() < n.intValue()) errors.add(path + ": shorter than " + n);
            if (schema.get("maxLength") instanceof Number n && s.length() > n.intValue()) errors.add(path + ": longer than " + n);
        }
        if (value instanceof Number num) {
            if (schema.get("minimum") instanceof Number n && num.doubleValue() < n.doubleValue()) errors.add(path + ": below " + n);
            if (schema.get("maximum") instanceof Number n && num.doubleValue() > n.doubleValue()) errors.add(path + ": above " + n);
        }
        if ("object".equals(type) && value instanceof Map<?, ?> obj) {
            for (Object req : Json.arr(schema.get("required"))) {
                if (!obj.containsKey(req)) errors.add(path + "." + req + ": is required");
            }
            Map<String, Object> props = Json.obj(schema.get("properties"));
            for (Map.Entry<?, ?> e : obj.entrySet()) {
                String key = String.valueOf(e.getKey());
                if (props.containsKey(key)) check(Json.obj(props.get(key)), e.getValue(), path + "." + key, errors);
                else if (Boolean.FALSE.equals(schema.get("additionalProperties"))) errors.add(path + "." + key + ": unexpected property");
            }
        }
        if ("array".equals(type) && value instanceof List<?> list && schema.get("items") instanceof Map) {
            for (int i = 0; i < list.size(); i++) check(Json.obj(schema.get("items")), list.get(i), path + "[" + i + "]", errors);
        }
    }
}
