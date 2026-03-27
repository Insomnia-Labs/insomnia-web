import { onRequest as __api_auth__action__js_onRequest } from "C:\\workspace\\Insomnia-Labs\\insomnia-web\\functions\\api\\auth\\[action].js"
import { onRequest as __api_tg__action__js_onRequest } from "C:\\workspace\\Insomnia-Labs\\insomnia-web\\functions\\api\\tg\\[action].js"

export const routes = [
    {
      routePath: "/api/auth/:action",
      mountPath: "/api/auth",
      method: "",
      middlewares: [],
      modules: [__api_auth__action__js_onRequest],
    },
  {
      routePath: "/api/tg/:action",
      mountPath: "/api/tg",
      method: "",
      middlewares: [],
      modules: [__api_tg__action__js_onRequest],
    },
  ]