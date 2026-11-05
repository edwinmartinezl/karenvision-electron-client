import { setActiveScreenName, setScreenAnim } from "./state-store.js";

export function createScreenRouter({ state, el, prefersReducedMotion = false, onLeaveViewer } = {}) {
  function clearScreenInlineStyles(node) {
    if (!node) return;
    node.style.opacity = "";
    node.style.transform = "";
    node.style.pointerEvents = "";
    node.style.zIndex = "";
  }

  function cancelScreenTransition() {
    const current = state.screenAnim;
    if (!current) return;
    const animations = Array.isArray(current) ? current : [current];
    animations.forEach((anim) => {
      try {
        anim?.cancel?.();
      } catch (_) {
        // no-op
      }
    });
    setScreenAnim(null);
  }

  function animateScreenTransition(fromNode, toNode, direction = 1) {
    if (!toNode || prefersReducedMotion || typeof toNode.animate !== "function") {
      if (fromNode && fromNode !== toNode) {
        fromNode.classList.remove("active");
        clearScreenInlineStyles(fromNode);
      }
      if (toNode) {
        toNode.classList.add("active");
        clearScreenInlineStyles(toNode);
      }
      return;
    }
    cancelScreenTransition();
    clearScreenInlineStyles(fromNode);
    clearScreenInlineStyles(toNode);

    const signedDir = direction >= 0 ? 1 : -1;
    const enterX = `${signedDir * 100}%`;
    const exitX = `${signedDir * -100}%`;

    if (fromNode && fromNode !== toNode) {
      fromNode.classList.add("active");
      fromNode.style.zIndex = "1";
      fromNode.style.pointerEvents = "none";
      fromNode.style.opacity = "1";
      fromNode.style.transform = "translateX(0%)";
    }

    toNode.classList.add("active");
    toNode.style.zIndex = "2";
    toNode.style.opacity = "1";
    toNode.style.transform = `translateX(${enterX})`;
    toNode.style.pointerEvents = "none";

    const finish = () => {
      if (state.screenAnim == null) {
        return;
      }
      if (fromNode && fromNode !== toNode) {
        fromNode.classList.remove("active");
        clearScreenInlineStyles(fromNode);
      }
      if (toNode) {
        clearScreenInlineStyles(toNode);
      }
      setScreenAnim(null);
    };

    try {
      const anims = [];
      if (fromNode && fromNode !== toNode && typeof fromNode.animate === "function") {
        anims.push(fromNode.animate(
          [
            { transform: "translateX(0%)" },
            { transform: `translateX(${exitX})` }
          ],
          { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
        ));
      }

      anims.push(toNode.animate(
        [
          { transform: `translateX(${enterX})` },
          { transform: "translateX(0%)" }
        ],
        { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
      ));

      setScreenAnim(anims);
      const activeAnimRef = anims;
      const finishIfCurrent = () => {
        if (state.screenAnim !== activeAnimRef) {
          return;
        }
        finish();
      };
      Promise.allSettled(anims.map((a) => a.finished)).then(finishIfCurrent);
      setTimeout(finishIfCurrent, 650);
    } catch (_err) {
      setScreenAnim(null);
      finish();
    }
  }

  function setScreen(name) {
    const screenMap = {
      url: el.screenUrl,
      login: el.screenLogin,
      viewer: el.screenViewer
    };
    const nextNode = screenMap[name];
    if (!nextNode) {
      return;
    }
    const currentName = state.activeScreenName;
    const currentNode = screenMap[currentName] || document.querySelector(".screen.active");
    if (currentNode === nextNode) {
      if (el.status) {
        el.status.classList.toggle("hidden", name !== "viewer");
      }
      if (name !== "viewer") {
        onLeaveViewer?.();
      }
      return;
    }

    const order = { url: 0, login: 1, viewer: 2 };
    const direction = (order[name] ?? 0) >= (order[currentName] ?? 0) ? 1 : -1;

    Object.values(screenMap).forEach((node) => {
      if (node !== nextNode && node !== currentNode) {
        node.classList.remove("active");
        clearScreenInlineStyles(node);
      }
    });
    animateScreenTransition(currentNode, nextNode, direction);
    setActiveScreenName(name);

    if (el.status) {
      el.status.classList.toggle("hidden", name !== "viewer");
    }
    if (name !== "viewer") {
      onLeaveViewer?.();
    }
  }

  return {
    clearScreenInlineStyles,
    cancelScreenTransition,
    animateScreenTransition,
    setScreen
  };
}

