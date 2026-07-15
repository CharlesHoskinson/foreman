/* Foreman docs - minimal interaction */
(function () {
  const toggle = document.querySelector(".nav-toggle");
  const menu = document.getElementById("nav-menu");
  if (toggle && menu) {
    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        menu.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const links = Array.from(document.querySelectorAll(".nav-links a[href^='#']"));
  const sections = links
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  function setCurrent() {
    let active = null;
    const y = window.scrollY + 96;
    for (const sec of sections) {
      if (sec.offsetTop <= y) active = sec;
    }
    links.forEach((a) => {
      const match = active && a.getAttribute("href") === "#" + active.id;
      if (match) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  }

  window.addEventListener("scroll", setCurrent, { passive: true });
  setCurrent();
})();
