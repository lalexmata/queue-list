/**
 * Middleware que protege rutas sociales.
 * Redirige a /social/login si no hay sesión activa.
 */
function requireSocialAuth(req, res, next) {
  if (req.session && req.session.socialAuthed) {
    return next();
  }
  res.redirect("/social/login");
}

module.exports = { requireSocialAuth };
