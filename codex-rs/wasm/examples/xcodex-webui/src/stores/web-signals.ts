import { saveWebSignalSitesSnapshot } from "../apsix/workspace";
import { scanCurrentAiSurface } from "../runtime/browser-tools";

function createWebSignalsStore() {
  let poller: number | null = null;

  async function refresh() {
    try {
      const snapshot = await scanCurrentAiSurface();
      await saveWebSignalSitesSnapshot(snapshot);
    } catch (error) {
      console.warn("[webui] web-signals:refresh-failed", error);
    }
  }

  return {
    async initialize() {
      await refresh();
      if (poller === null) {
        poller = window.setInterval(() => {
          void refresh();
        }, 20_000);
      }

      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          void refresh();
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);

      return () => {
        if (poller !== null) {
          window.clearInterval(poller);
          poller = null;
        }
        document.removeEventListener("visibilitychange", onVisibilityChange);
      };
    },
  };
}

export const webSignalsStore = createWebSignalsStore();
