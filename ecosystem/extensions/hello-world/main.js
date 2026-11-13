// Sample extension. Plain JavaScript so it can be loaded without a build step.
module.exports = {
  activate(ctx) {
    ctx.registerCommand("sayHello", (name) => `Hello ${name || "developer"} from ${ctx.extensionId}!`);

    ctx.registerTool({
      spec: {
        name: "count_lines",
        description: "Count the lines of a workspace file.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", minLength: 1 } },
          required: ["path"],
          additionalProperties: false,
        },
      },
      handler: async ({ path }) => {
        const text = await ctx.readFile(String(path));
        return { path, lines: text.split(/\r?\n/).length };
      },
    });
    ctx.log("activated");
  },
  deactivate() {},
};
