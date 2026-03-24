const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");

//feb14 sprint
const ingredientRoutes = require("./routes/ingredients");
const menuRoutes = require("./routes/menu");
const customerRoutes = require("./routes/customers");
const profileRoutes = require("./routes/profile");
const metaRoutes = require("./routes/meta");
const purchaseRoutes = require("./routes/purchases");
const purchaseOrderRoutes = require("./routes/purchaseOrders");
const inventoryRoutes = require("./routes/inventory");

const app = express();

const corsOptions = {
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(express.json());


app.get("/api/health", (req, res) => res.json({ ok: true }));


app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);


app.use("/api/ingredients", ingredientRoutes);
app.use("/api/menu", menuRoutes);
// Alias to match specification: /api/menu-items -> menu routes
app.use("/api/menu-items", menuRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/meta", metaRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/inventory", inventoryRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
