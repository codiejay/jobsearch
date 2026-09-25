// Lets plain Node load the site's TypeScript in lib/ (Node 24 strips the
// types itself). The lib files import without extensions, the way Next
// expects, so this tries ".ts" when a relative import has none.
import { registerHooks } from "node:module";

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (/^\.{1,2}\//.test(spec) && !/\.\w+$/.test(spec)) return next(spec + ".ts", ctx);
      throw e;
    }
  },
});
