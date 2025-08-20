const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = 3000;

// ✅ Azure Cosmos DB MongoDB connection URI
const mongoUrl = 'mongodb+srv://guardiadbserviceuserdev:D9TaJGmaSy5v9C3@guardia-db-dev.global.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000';
const dbName = 'qa-guardian-database';

let db;

app.use(express.json());
app.use(express.static(__dirname)); // Serve index.html and static files

// ✅ Connect to Cosmos DB and define routes
MongoClient.connect(mongoUrl, {
  serverApi: { version: '1', strict: true, deprecationErrors: true }
})
  .then(client => {
    console.log('✅ Connected to Azure Cosmos DB (Mongo API)');
    db = client.db(dbName);

    // 🔍 Fetch property details
    app.get('/property/:id', async (req, res) => {
      const propertyId = req.params.id;
      console.log('🌐 Request for propertyId:', propertyId);

      try {
        let isValidObjectId = /^[0-9a-fA-F]{24}$/.test(propertyId);

        const orQuery = isValidObjectId
          ? [{ _id: new ObjectId(propertyId) }, { _id: propertyId }]
          : [{ _id: propertyId }];

        console.log('📄 Querying with $or:', orQuery);

        const property = await db.collection('properties').findOne({ $or: orQuery });

        if (!property) {
          console.log('❌ Property not found for any type of _id:', propertyId);
          return res.status(404).send('Property not found');
        }

        const { propertyName, locationDetails } = property;

        if (!locationDetails || locationDetails.latitude == null || locationDetails.longitude == null) {
          console.log('⚠️ Property found but missing coordinates');
          return res.status(400).send('Property location coordinates missing');
        }

        const geofence = await db.collection('propertygeofences').findOne({
          propertyId: property._id
        });

        console.log('✅ Property found:', propertyName);

        res.json({
          propertyId: property._id,
          propertyName,
          center: {
            lat: locationDetails.latitude,
            lng: locationDetails.longitude,
          },
          boundary: geofence ? geofence.boundary : null
        });
      } catch (err) {
        console.error('❌ Error fetching property:', err);
        res.status(500).send('Failed to fetch property');
      }
    });

    // 💾 Save or update customer boundary
    app.post('/save-boundary', async (req, res) => {
      const { propertyName, path } = req.body;
      if (!propertyName || !path || !Array.isArray(path)) {
        return res.status(400).send('Property name and boundary path are required.');
      }

      try {
        const property = await db.collection('properties').findOne({ propertyName });
        if (!property) {
          return res.status(404).send('Property not found in properties collection');
        }

        const updateResult = await db.collection('propertygeofences').updateOne(
          { propertyId: property._id },
          {
            $set: {
              propertyName: property.propertyName,
              boundary: path,
              updatedAt: new Date()
            },
            $setOnInsert: {
              propertyId: property._id,
              createdAt: new Date()
            }
          },
          { upsert: true }
        );

        if (updateResult.upsertedCount > 0) {
          console.log(`✅ New boundary created for propertyId: ${property._id}`);
          res.json({ message: 'Boundary saved to MongoDB!', action: 'created' });
        } else {
          console.log(`✅ Boundary updated for propertyId: ${property._id}`);
          res.json({ message: 'Boundary updated in MongoDB!', action: 'updated' });
        }
      } catch (err) {
        console.error('❌ Error saving boundary:', err);
        res.status(500).send('Failed to save boundary to MongoDB');
      }
    });

    // 🗑️ Delete a boundary
    app.delete('/delete-boundary/:propertyId', async (req, res) => {
      const propertyId = req.params.propertyId;
      try {
        const deleteResult = await db.collection('propertygeofences').deleteOne({
          propertyId: new ObjectId(propertyId)
        });

        if (deleteResult.deletedCount === 0) {
          console.log('⚠️ No boundary found to delete for propertyId:', propertyId);
          return res.status(404).send('No boundary found to delete');
        }

        console.log(`🗑️ Deleted boundary for propertyId: ${propertyId}`);
        res.json({ message: 'Boundary deleted from MongoDB!' });
      } catch (err) {
        console.error('❌ Error deleting boundary:', err);
        res.status(500).send('Failed to delete boundary from MongoDB');
      }
    });

    // ✅ Save boots-on-ground verified boundary
    app.post('/save-verified-boundary', async (req, res) => {
      const { propertyId, verifiedBoundary } = req.body;

      if (!propertyId || !Array.isArray(verifiedBoundary) || verifiedBoundary.length < 3) {
        return res.status(400).send('Property ID and valid verified boundary are required.');
      }

      try {
        const result = await db.collection('propertygeofences').updateOne(
          { propertyId: new ObjectId(propertyId) },
          {
            $set: {
              verifiedBoundary,
              updatedAt: new Date(),
            }
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send('No matching property boundary found');
        }

        res.json({ message: 'Verified boundary saved!' });
      } catch (err) {
        console.error('❌ Error saving verified boundary:', err);
        res.status(500).send('Server error saving verified boundary');
      }
    });

    // 🔍 List all property IDs
    app.get('/list-properties', async (req, res) => {
      try {
        const properties = await db.collection('properties').find({}, {
          projection: { _id: 1, propertyName: 1 }
        }).toArray();

        console.log('📄 Listing all property IDs:');
        properties.forEach(p =>
          console.log('🆔', p._id, '|', typeof p._id, '|', p.propertyName)
        );

        res.json(properties);
      } catch (err) {
        console.error('❌ Error listing properties:', err);
        res.status(500).send('Failed to list properties');
      }
    });

    // 🚀 Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
  });
