(function () {
  var PLACEHOLDER = "（共有されたキー）";
  var STORAGE_KEY = "estat-app-id";

  function collectTargets() {
    var targets = [];
    var blocks = document.querySelectorAll("pre");
    blocks.forEach(function (block) {
      var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        var node = walker.currentNode;
        if (node.nodeValue.indexOf(PLACEHOLDER) !== -1) {
          targets.push({ node: node, original: node.nodeValue });
        }
      }
    });
    return targets;
  }

  function setup() {
    var input = document.getElementById("estat-app-id");
    if (!input) {
      return;
    }

    var targets = collectTargets();

    function apply(value) {
      var replacement = value.trim() === "" ? PLACEHOLDER : value.trim();
      targets.forEach(function (target) {
        target.node.nodeValue = target.original.split(PLACEHOLDER).join(replacement);
      });
    }

    var saved = "";
    try {
      saved = localStorage.getItem(STORAGE_KEY) || "";
    } catch (error) {
      saved = "";
    }
    if (saved !== "") {
      input.value = saved;
      apply(saved);
    }

    input.addEventListener("input", function () {
      try {
        localStorage.setItem(STORAGE_KEY, input.value);
      } catch (error) {
        // 保存できない環境でも置き換えだけは行う
      }
      apply(input.value);
    });
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(setup);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();
