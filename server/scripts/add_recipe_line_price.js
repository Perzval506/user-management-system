const pool = require("../db");

(async () => {
  try {
    console.log("Ensuring recipe_ingredients.price exists...");
    try {
      await pool.query(
        "ALTER TABLE recipe_ingredients ADD COLUMN price DECIMAL(12,2) NULL AFTER qty_unit"
      );
      console.log("Added recipe_ingredients.price");
    } catch (error) {
      console.log("recipe_ingredients.price already exists or ALTER failed:", error.message);
    }

    process.exit(0);
  } catch (err) {
    console.error("Migration failed", err);
    process.exit(1);
  }
})();
