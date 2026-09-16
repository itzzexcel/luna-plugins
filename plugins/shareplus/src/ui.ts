const SUBMENU_MARKER = "Music shared from TIDAL can be opened on other services";

export function getOwnSubMenu(
  root: ParentNode = document
): HTMLElement | null {
  const markerEl = findElementByText(root, SUBMENU_MARKER);
  if (!markerEl) return null;

  let parent: HTMLElement | null = markerEl.parentElement;

  while (parent) {
    const className =
      typeof parent.className === "string"
        ? parent.className
        : (parent.className as unknown as SVGAnimatedString)?.baseVal ?? "";

    if (className.includes("_subMenu_")) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return null;
}

function findElementByText(
  root: ParentNode,
  text: string
): HTMLElement | null {
  const byTitle = root.querySelector<HTMLElement>(
    `[title="${CSS.escape(text)}"]`
  );
  if (byTitle) return byTitle;

  const walker = document.createTreeWalker(
    root as Node,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as HTMLElement;
        const ownText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent?.trim())
          .join("");
        return ownText === text
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    }
  );

  return walker.nextNode() as HTMLElement | null;
}