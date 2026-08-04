/**
 * Middleware que protege rutas sociales.
 * Redirige a /social/login si no hay sesión activa.
 */
function requireSocialAuth(req, res, next) {
  if (req.session && req.session.socialAuthed) {
    return next();
  }
  const nextPath = req.originalUrl?.startsWith("/") ? req.originalUrl : "/";
  res.redirect(`/social/login?next=${encodeURIComponent(nextPath)}`);
}

module.exports = { requireSocialAuth };
