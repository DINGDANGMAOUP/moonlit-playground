import { definePlugin } from "@halo-dev/ui-shared";

export default definePlugin({
  components: {},
  routes: [],
  extensionPoints: {
    "default:editor:extension:create": async () => {
      const { MoonlitPlaygroundExtension } = await import("./editor");
      return [MoonlitPlaygroundExtension];
    },
  },
});
