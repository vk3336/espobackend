const { espoRequest } = require("../controller/espoClient");

// Bulk fetch entities using EspoCRM's "in" operator
async function espoList(entityType, searchParamsObj) {
  const query = {
    searchParams: JSON.stringify(searchParamsObj),
  };

  return await espoRequest(`/${entityType}`, { query });
}

// Utility to split array into chunks
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// MAIN: Bulk attach collections to products
async function attachCollections(products, opts = {}) {
  const {
    idField = "collectionId",
    targetField = "collection",
    collectionEntity = "CCollection",
    select = ["id", "name", "slug"],
    chunkSize = 80,
  } = opts;

  // Extract unique collection IDs, filter out falsy values
  const ids = [...new Set(products.map((p) => p?.[idField]).filter(Boolean))];

  if (ids.length === 0) {
    return products.map((p) => ({ ...p, [targetField]: null }));
  }

  const byId = Object.create(null);

  // Process in chunks to avoid URL length limits
  for (const idsChunk of chunk(ids, chunkSize)) {
    const { list = [] } = await espoList(collectionEntity, {
      maxSize: idsChunk.length,
      select,
      where: [{ type: "in", attribute: "id", value: idsChunk }],
    });

    // Build lookup map
    for (const c of list) {
      byId[c.id] = c;
    }
  }

  // Attach collections to products
  return products.map((p) => ({
    ...p,
    [targetField]: p?.[idField] ? byId[p[idField]] || null : null,
  }));
}

// Bulk attach any related entities (accounts, users, etc.)
async function attachRelatedEntities(products, entityConfigs) {
  let result = [...products];

  for (const config of entityConfigs) {
    const {
      idField,
      targetField,
      entityType,
      select = ["id", "name"],
      chunkSize = 80,
    } = config;

    // Extract unique IDs for this entity type
    const ids = [...new Set(result.map((p) => p?.[idField]).filter(Boolean))];

    if (ids.length === 0) {
      result = result.map((p) => ({ ...p, [targetField]: null }));
      continue;
    }

    const byId = Object.create(null);

    // Fetch in chunks
    for (const idsChunk of chunk(ids, chunkSize)) {
      const { list = [] } = await espoList(entityType, {
        maxSize: idsChunk.length,
        select,
        where: [{ type: "in", attribute: "id", value: idsChunk }],
      });

      for (const entity of list) {
        byId[entity.id] = entity;
      }
    }

    // Attach to products
    result = result.map((p) => ({
      ...p,
      [targetField]: p?.[idField] ? byId[p[idField]] || null : null,
    }));
  }

  return result;
}

module.exports = {
  espoList,
  attachCollections,
  attachRelatedEntities,
  chunk,
};
