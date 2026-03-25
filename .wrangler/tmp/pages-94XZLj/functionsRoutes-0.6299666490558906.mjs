import { onRequest as __api_tg__action__js_onRequest } from "C:\\workspace\\Insomnia-Labs\\insomnia-web\\functions\\api\\tg\\[action].js"

export const routes = [
    {
      routePath: "/api/tg/:action",
      mountPath: "/api/tg",
      method: "",
      middlewares: [],
      modules: [__api_tg__action__js_onRequest],
    },
  ]