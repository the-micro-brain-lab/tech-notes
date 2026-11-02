// Highlight the contents-rail link of the section being read (see .note-toc in site.css).
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll(".note-toc a[href^='#']"));
  if (!links.length || !("IntersectionObserver" in window)) return;
  var linkFor = new Map();
  links.forEach(function (a) {
    var target = document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
    if (target) linkFor.set(target.closest("section") || target, a);
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.remove("on"); });
      linkFor.get(e.target).classList.add("on");
    });
  }, { rootMargin: "-30% 0px -60% 0px" });
  linkFor.forEach(function (_, el) { io.observe(el); });
})();
