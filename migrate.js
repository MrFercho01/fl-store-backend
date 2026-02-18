require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs').promises;
const Product = require('./models/Product');
const User = require('./models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/flstore';

async function migrate() {
  try {
    // Conectar a MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Conectado a MongoDB');

    // Leer datos del archivo JSON
    const data = await fs.readFile('./db.json', 'utf8');
    const jsonData = JSON.parse(data);

    // Migrar productos
    if (jsonData.products && jsonData.products.length > 0) {
      await Product.deleteMany({}); // Limpiar productos existentes
      await Product.insertMany(jsonData.products);
      console.log(`✅ ${jsonData.products.length} productos migrados`);
      
      // Mostrar productos migrados
      jsonData.products.forEach(p => {
        console.log(`  - ${p.name} (${p.category})`);
      });
    } else {
      console.log('⚠️  No hay productos para migrar');
    }

    // Migrar usuarios (si no existen)
    const existingUsers = await User.countDocuments();
    if (existingUsers === 0 && jsonData.users) {
      await User.insertMany(jsonData.users);
      console.log(`✅ ${jsonData.users.length} usuarios migrados`);
    }

    console.log('\n🎉 Migración completada exitosamente!');
    
  } catch (error) {
    console.error('❌ Error en la migración:', error);
  } finally {
    await mongoose.connection.close();
  }
}

migrate();
