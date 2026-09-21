const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const listingsRoutes = require('./routes/listings.routes');
const bookingsRoutes = require('./routes/bookings.routes');
const devicesRoutes = require('./routes/devices.routes');
const paymentsRoutes = require('./routes/payments.routes');
const usersRoutes = require('./routes/users.routes');
const adminRoutes = require('./routes/admin.routes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Request logging. Custom format adds the authenticated user's id (when
// present) so you can trace which account made a given call while testing
// from the app — morgan logs on response finish, by which point
// requireAuth (if this route needed it) has already set req.user.
morgan.token('user', (req) => (req.user ? req.user.id.slice(0, 8) : '-'));
app.use(
  morgan(':method :url :status :response-time ms — user::user', {
    skip: (req) => req.path === '/health',
  })
);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/listings', listingsRoutes);
app.use('/bookings', bookingsRoutes);
app.use('/devices', devicesRoutes);
app.use('/payments', paymentsRoutes);
app.use('/users', usersRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Must be registered last — Express identifies error middleware by arity (4 args).
app.use(errorHandler);

module.exports = { app };
