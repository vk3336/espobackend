const express = require("express");
const { createEntityController } = require("../controller/genericController");

// Generic route factory that creates routes for any entity
const createEntityRoutes = (entityName) => {
  const router = express.Router();
  const controller = createEntityController(entityName);

  // GET /:entity - Get all records
  router.get("/", controller.getAllRecords);

  // GET /:entity/fieldname/:fieldName - Get unique values for specified field
  router.get("/fieldname/:fieldName", controller.getUniqueFieldValues);

  // GET /:entity/fieldname/:fieldName/:fieldValue - Get records filtered by field and value
  router.get(
    "/fieldname/:fieldName/:fieldValue",
    controller.getRecordsByFieldValue
  );

  // GET /:entity/:id - Get single record by ID
  router.get("/:id", controller.getRecordById);

  // POST /:entity - Create new record
  router.post("/", controller.createRecord);

  // PUT /:entity/:id - Update record by ID
  router.put("/:id", controller.updateRecord);

  // DELETE /:entity/:id - Delete record by ID
  router.delete("/:id", controller.deleteRecord);

  return router;
};

module.exports = { createEntityRoutes };
