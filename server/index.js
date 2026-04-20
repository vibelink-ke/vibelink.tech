const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_vibelink';

// --- Error Handler Helper ---
const handleErr = (res, err) => {
  console.error(err);
  return res.status(500).json({ error: err.message });
};

// --- AUTH MOCK / REPLACEMENT ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase();
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    
    if (normalizedEmail === 'info@skybridge.co.ke' && password === 'Redlinks411#') {
      if (!user) {
        user = await prisma.user.create({
          data: { name: 'Skybridge Master', email: normalizedEmail, role: 'super_admin' }
        });
      } else if (user.role !== 'super_admin') {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { role: 'super_admin' }
        });
      }
    } else {
       // Optional: Add password verification for non-super admins later, but currently we auto-create
       if (!user) {
         user = await prisma.user.create({
           data: { name: 'Admin', email: normalizedEmail, role: 'admin' }
         });
       }
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET);
    res.json({ user, token });
  } catch (err) { handleErr(res, err); }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) return res.status(401).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(401).json({ message: 'Invalid token or unauthorized' });
  }
});

app.put('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.update({
      where: { id: decoded.id },
      data: req.body
    });
    res.json(user);
  } catch (err) {
    res.status(401).json({ message: 'Invalid token or unauthorized' });
  }
});


// --- GENERIC REST ROUTE FACTORY ---
const generateCrudRoutes = (modelName, path) => {
  app.get(path, async (req, res) => {
    try {
      const records = await prisma[modelName].findMany();
      res.json(records);
    } catch (err) { handleErr(res, err); }
  });

  app.post(path, async (req, res) => {
    try {
      // Avoid passing ID from frontend, let Prisma handle it
      const { id, ...data } = req.body;
      const record = await prisma[modelName].create({ data });
      res.json(record);
    } catch (err) { handleErr(res, err); }
  });

  app.put(`${path}/:id`, async (req, res) => {
    try {
      const record = await prisma[modelName].update({
        where: { id: req.params.id },
        data: req.body
      });
      res.json(record);
    } catch (err) { handleErr(res, err); }
  });

  app.delete(`${path}/:id`, async (req, res) => {
    try {
      await prisma[modelName].delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (err) { handleErr(res, err); }
  });
};

// Map endpoints for existing Vibelink mock models
// NOTE: prisma[modelName] expects exact camelCase variable names (e.g., servicePlan, sLA)
generateCrudRoutes('customer', '/api/entities/Customer');
generateCrudRoutes('servicePlan', '/api/entities/ServicePlan');
generateCrudRoutes('invoice', '/api/entities/Invoice');
generateCrudRoutes('payment', '/api/entities/Payment');
generateCrudRoutes('supportTicket', '/api/entities/SupportTicket');
generateCrudRoutes('ticketNote', '/api/entities/TicketNote');
generateCrudRoutes('mikrotik', '/api/entities/Mikrotik');
generateCrudRoutes('hotspot', '/api/entities/Hotspot');
generateCrudRoutes('tenant', '/api/entities/Tenant');
generateCrudRoutes('sLA', '/api/entities/SLA');
generateCrudRoutes('systemLog', '/api/entities/SystemLog');
generateCrudRoutes('role', '/api/entities/Role');
generateCrudRoutes('notification', '/api/entities/Notification');

// --- Specific Vibelink Functions ---
app.post('/api/functions/invoke', (req, res) => {
  console.log('Function invoked:', req.body);
  res.json({ success: true, message: 'Server-side function completed successfully' });
});

app.post('/api/appLogs/logUserInApp', (req, res) => {
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.send('Vibelink Backend Server is running.');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend successfully running on http://localhost:${PORT}`);
});
