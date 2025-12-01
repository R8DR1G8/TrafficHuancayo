// 1. IMPORTACIONES DE FIREBASE (Usando CDN para que funcione en GitHub)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// 2. CONFIGURACIÓN
const firebaseConfig = {
  apiKey: "AIzaSyCT2LpdYBtehgXtweJ4gUC80zl7DaM-EI8",
  authDomain: "traffichuancayo.firebaseapp.com",
  projectId: "traffichuancayo",
  storageBucket: "traffichuancayo.firebasestorage.app",
  messagingSenderId: "833467436838",
  appId: "1:833467436838:web:1d0dbc1ffcbbd69b3ffbe7"
};

// 3. INICIALIZAR
const appFirebase = initializeApp(firebaseConfig);
const db = getFirestore(appFirebase);

console.log("🔥 Firebase conectado dentro de script1.js");


// --- DATOS HUANCAYO (Base de Conocimiento de Tráfico) ---
const DATA_HUANCAYO = {
  "type": "FeatureCollection",
  "features": [
    { "properties": { "name":"Av. Ferrocarril & Ayacucho", "tipo":"congestion", "intensity":5, "desc":"Comercio intenso" }, "geometry": { "type":"Point", "coordinates":[-75.2103,-12.0679]} },
    { "properties": { "name":"Puente Breña", "tipo":"congestion", "intensity":5, "desc":"Bloqueo entrada" }, "geometry": { "type":"Point", "coordinates":[-75.2285,-12.0580]} },
    { "properties": { "name":"Av. San Carlos", "tipo":"accidente", "intensity":4, "desc":"Choque leve" }, "geometry": { "type":"Point", "coordinates":[-75.2220,-12.0745]} },
    { "properties": { "name":"Jr. Real & Loreto", "tipo":"paradero", "intensity":3, "desc":"Colectivos" }, "geometry": { "type":"Point", "coordinates":[-75.2061,-12.0663]} },
    { "properties": { "name":"Mercado Modelo", "tipo":"comercio", "intensity":5, "desc":"Carga/Descarga" }, "geometry": { "type":"Point", "coordinates":[-75.2084,-12.0672]} },
    { "properties": { "name":"Terminal Terrestre", "tipo":"paradero", "intensity":3, "desc":"Bus Salida" }, "geometry": { "type":"Point", "coordinates":[-75.2267,-12.0768]} },
    { "properties": { "name":"Av. Circunvalación", "tipo":"congestion", "intensity":4, "desc":"Semáforo mal" }, "geometry": { "type":"Point", "coordinates":[-75.2201,-12.0715]} }
  ]
};

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { window.app = new TrafficApp(); }, 100);
});

class TrafficApp {
constructor() {
  this.state = {
    reports: JSON.parse(localStorage.getItem('th_reports_final') || '[]'),
    heatOn: true,
    routeStart: null,
    routeEnd: null,
    generatedRoutes: []
  };

  this.map = null;
  this.chartInstance = null;

  this.initMap();
  this.initUI();
  this.loadData();
  this.listenRealtimeReports(); // << 🔥 Se agrega aquí
}


  initMap() {
    this.map = L.map('map', { zoomControl: false }).setView([-12.0680, -75.2100], 14);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);

    L.control.zoom({ position: 'topright' }).addTo(this.map);

    this.layers = {
      heat: L.heatLayer([], { radius: 25, blur: 15, gradient: {0.4: 'blue', 0.65: 'lime', 1: 'red'} }),
      markers: L.layerGroup().addTo(this.map),
      routeMarkers: L.layerGroup().addTo(this.map),
      routeLinesGroup: L.layerGroup().addTo(this.map) // Capa dedicada a lineas de ruta
    };
    
    if (this.state.heatOn) this.layers.heat.addTo(this.map);

    this.map.on('contextmenu', (e) => this.handleMapRightClick(e));
    setTimeout(() => { this.map.invalidateSize(); }, 500);
  }

  loadData() {
    this.renderMapElements();
    this.renderSidebarList();
    this.updateStats();
  }
// 🔥 Sincronización en tiempo real con Firebase
listenRealtimeReports() {
  onSnapshot(collection(db, "reportes"), (snapshot) => {
    this.state.reports = snapshot.docs.map(d => d.data());
    this.renderMapElements();
    this.updateStats();
    console.log("📡 Datos actualizados desde Firestore");
  });
}

  // --- LOGICA INTELIGENTE DE RUTAS ---

  handleMapRightClick(e) {
    const { lat, lng } = e.latlng;

    if (!this.state.routeStart) {
      this.state.routeStart = L.latLng(lat, lng);
      this.addRouteMarker(lat, lng, 'start');
      document.getElementById('route-start').value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      this.showToast('📍 Punto de Partida fijado. Selecciona destino.', 'success');
      this.switchTab('route');
    } else {
      // Si ya hay inicio, el siguiente click es fin (o actualiza fin)
      this.state.routeEnd = L.latLng(lat, lng);
      
      // Limpiar marcador final anterior si existe
      this.layers.routeMarkers.eachLayer(layer => {
         if(layer.options.type === 'end') this.layers.routeMarkers.removeLayer(layer);
      });

      this.addRouteMarker(lat, lng, 'end');
      document.getElementById('route-end').value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      this.calculateRoute();
    }
  }

  addRouteMarker(lat, lng, type) {
    const color = type === 'start' ? '#10b981' : '#ef4444';
    const icon = L.divIcon({
      className: 'custom-pin',
      html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 0 10px ${color}"></div>`
    });
    const marker = L.marker([lat, lng], { icon, type: type });
    marker.addTo(this.layers.routeMarkers);
  }

  calculateRoute() {
    // Limpiar rutas previas
    if (this.routingControl) {
      this.map.removeControl(this.routingControl);
      this.routingControl = null;
    }
    this.layers.routeLinesGroup.clearLayers();
    document.getElementById('route-options-container').innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8">Calculando rutas óptimas con IA... 🔄</div>';
    document.getElementById('route-options-container').classList.remove('hidden');
    document.getElementById('btnClearRoute').classList.remove('hidden');

    // Configurar OSRM para pedir alternativas
    this.routingControl = L.Routing.control({
      waypoints: [this.state.routeStart, this.state.routeEnd],
      router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1',
        profile: 'driving',
        routingOptions: {
          alternatives: true, // ¡CLAVE! Pedimos rutas alternativas
          steps: false
        }
      }),
      // Desactivamos el dibujo automático por defecto para tener control manual de colores
      createMarker: () => null,
      fitSelectedRoutes: true,
      show: false,
      autoRoute: true
    }).addTo(this.map);

    this.routingControl.on('routesfound', (e) => {
      this.processRoutes(e.routes);
    });
    
    this.routingControl.on('routingerror', () => {
       this.showToast('Error calculando ruta. Intenta puntos más cercanos.', 'error');
    });
  }

  // ALGORITMO DE OPTIMIZACIÓN
  processRoutes(routes) {
    const container = document.getElementById('route-options-container');
    container.innerHTML = '';
    
    // 1. Analizar cada ruta
    const analyzed = routes.map((route, index) => {
      const stats = this.analyzeTrafficImpact(route);
      return {
        id: index,
        routeObj: route,
        baseTime: Math.round(route.summary.totalTime / 60),
        dist: (route.summary.totalDistance / 1000).toFixed(1),
        trafficPenalty: stats.penalty,
        conflicts: stats.conflicts,
        realTime: Math.round(route.summary.totalTime / 60) + stats.penalty
      };
    });

    // 2. Ordenar: La mejor es la que tiene MENOR tiempo real (Base + Tráfico)
    analyzed.sort((a, b) => a.realTime - b.realTime);

    // Guardamos para uso global
    this.state.generatedRoutes = analyzed;

    // 3. Renderizar Tarjetas y Líneas
    analyzed.forEach((r, idx) => {
      const isBest = idx === 0; // La primera es la mejor tras ordenar
      
      // Crear tarjeta UI
      const card = document.createElement('div');
      card.className = `route-card ${isBest ? 'selected' : 'bad-route'}`;
      card.onclick = () => this.highlightRoute(r.id);
      
      let badgeHtml = '';
      let timeHtml = '';
      
      if (isBest) {
        // Lógica de ahorro: Comparamos con la peor ruta (o la siguiente si solo hay una)
        const worstRoute = analyzed.length > 1 ? analyzed[analyzed.length - 1] : null;
        const saving = worstRoute ? (worstRoute.realTime - r.realTime) : 0;
        
        badgeHtml = `<span class="rc-tag tag-fast">⚡ RECOMENDADA</span>`;
        if(saving > 0) {
           timeHtml = `<div style="color:#10b981;font-size:0.8rem;margin-top:2px">¡Ahorras ${saving} min!</div>`;
        }
      } else {
        badgeHtml = `<span class="rc-tag tag-slow">⚠️ TRÁFICO ALTO</span>`;
        timeHtml = `<div style="color:#fca5a5;font-size:0.8rem;margin-top:2px">+${r.trafficPenalty} min demora</div>`;
      }

      card.innerHTML = `
        <div class="rc-header">
           <div class="rc-title">Opción ${String.fromCharCode(65 + idx)}</div>
           ${badgeHtml}
        </div>
        <div class="rc-time">${r.baseTime} min <span style="font-size:0.8rem;color:#fff;font-weight:400">(${r.dist} km)</span></div>
        ${timeHtml}
        <div class="rc-details">
           <span>${r.conflicts > 0 ? 'Cruza ' + r.conflicts + ' zonas rojas' : 'Vía despejada'}</span>
        </div>
      `;
      container.appendChild(card);

      // Dibujar línea en el mapa
      // Verde brillante para la mejor, gris transparente para las otras
      const lineColor = isBest ? '#10b981' : '#94a3b8';
      const lineOpacity = isBest ? 0.9 : 0.5;
      const lineWeight = isBest ? 6 : 4;
      const zIndex = isBest ? 1000 : 500;

      const line = L.Routing.line(r.routeObj, {
        styles: [{ color: lineColor, opacity: lineOpacity, weight: lineWeight }]
      });
      
      // Guardamos referencia ID para poder resaltarla luego
      line.routeId = r.id;
      line.addTo(this.layers.routeLinesGroup);
      
      // Traer al frente si es la mejor
      if(isBest) {
         // Hack para traer SVG al frente
         const path = line._layers[Object.keys(line._layers)[0]]._path;
         if(path) path.setAttribute('stroke-linecap', 'round');
      }
    });

    this.showToast(`✅ Se encontraron ${analyzed.length} rutas. Mostrando la más rápida.`, 'success');
  }

  analyzeTrafficImpact(route) {
    const coords = route.coordinates;
    let conflicts = 0;
    let penalty = 0; // Minutos extra

    // Revisar colisión con DATA_HUANCAYO
    DATA_HUANCAYO.features.forEach(spot => {
      const [sLng, sLat] = spot.geometry.coordinates;
      const intensity = spot.properties.intensity || 1;
      
      // Muestreo simple: chequear cada 10 coordenadas de la ruta para rendimiento
      for(let i=0; i < coords.length; i+=5) {
        const c = coords[i];
        const d = Math.sqrt(Math.pow(c.lat - sLat, 2) + Math.pow(c.lng - sLng, 2));
        
        // Si pasa a menos de ~100m (0.001 grados)
        if (d < 0.001) {
          conflicts++;
          // Algoritmo de penalización: Intensidad * 2.5 minutos
          penalty += (intensity * 2); 
          break; // Contar este punto una sola vez por ruta
        }
      }
    });
    
    return { conflicts, penalty };
  }

  highlightRoute(routeId) {
    // Actualizar UI visualmente
    const cards = document.querySelectorAll('.route-card');
    cards.forEach((c, idx) => {
       if(idx === this.state.generatedRoutes.findIndex(r => r.id === routeId)) {
         c.classList.add('selected');
         c.classList.remove('bad-route');
       } else {
         c.classList.remove('selected');
         c.classList.add('bad-route');
       }
    });

    // Actualizar líneas mapa
    this.layers.routeLinesGroup.clearLayers();
    
    this.state.generatedRoutes.forEach(r => {
      const isSelected = r.id === routeId;
      const color = isSelected ? (r.id === this.state.generatedRoutes[0].id ? '#10b981' : '#f59e0b') : '#64748b';
      const weight = isSelected ? 7 : 4;
      const opacity = isSelected ? 1 : 0.4;
      
      L.Routing.line(r.routeObj, {
        styles: [{ color: color, opacity: opacity, weight: weight }]
      }).addTo(this.layers.routeLinesGroup);
    });
  }

  clearRoute() {
    if (this.routingControl) {
      this.map.removeControl(this.routingControl);
      this.routingControl = null;
    }
    this.layers.routeLinesGroup.clearLayers();
    this.layers.routeMarkers.clearLayers();
    this.state.routeStart = null;
    this.state.routeEnd = null;
    
    document.getElementById('route-start').value = '';
    document.getElementById('route-end').value = '';
    document.getElementById('route-options-container').innerHTML = '';
    document.getElementById('route-options-container').classList.add('hidden');
    document.getElementById('btnClearRoute').classList.add('hidden');
    
    this.showToast('Mapa limpio.', 'default');
  }

  // --- RENDERIZADO VISUAL MAPA ---
  renderMapElements() {
    this.layers.markers.clearLayers();
    const heatPoints = [];

    DATA_HUANCAYO.features.forEach(f => {
      const [lng, lat] = f.geometry.coordinates;
      const { tipo, intensity, name } = f.properties;
      heatPoints.push([lat, lng, intensity/5]);

      const iconHTML = this.getIconHtml(tipo, intensity);
      const icon = L.divIcon({ html: iconHTML, className: 'c-icon', iconSize:[30,30], iconAnchor:[15,15] });
      
      L.marker([lat, lng], {icon})
        .bindPopup(`<div style="color:#333"><b>${name}</b><br>${f.properties.desc}</div>`)
        .addTo(this.layers.markers);
    });

    this.state.reports.forEach(r => {
      const lat = -12.068 + (Math.random() - 0.5) * 0.02; 
      const lng = -75.210 + (Math.random() - 0.5) * 0.02;
      heatPoints.push([lat, lng, 0.8]);
      const icon = L.divIcon({ html: '<div style="font-size:20px">📢</div>', className: '', iconSize:[24,24] });
      L.marker([lat, lng], {icon}).bindPopup(`<b>Reporte</b><br>${r.desc}`).addTo(this.layers.markers);
    });

    this.layers.heat.setLatLngs(heatPoints);
  }

  getIconHtml(tipo, intensity) {
    const icons = { congestion: '🛑', accidente: '🚑', paradero: '🚌', comercio: '🛒' };
    const color = intensity >= 4 ? '#ef4444' : '#f59e0b';
    return `<div style="background:${color};width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;font-size:16px;box-shadow:0 2px 5px rgba(0,0,0,0.3)">${icons[tipo] || '📍'}</div>`;
  }

  renderSidebarList() {
    const list = document.getElementById('alertList');
    list.innerHTML = '';
    DATA_HUANCAYO.features.forEach(f => {
      const li = document.createElement('li');
      li.innerHTML = `<div><strong>${f.properties.name}</strong><br><small style="color:#94a3b8">${f.properties.desc}</small></div><span style="font-size:1.2rem">${f.properties.intensity > 4 ? '🔴' : '🟡'}</span>`;
      list.appendChild(li);
    });
  }

  updateStats() {
    // Estadísticas simuladas pero funcionales
    let cCong = 0, cAcc = 0, cPar = 0;
    const allItems = [...DATA_HUANCAYO.features.map(f=>({tipo:f.properties.tipo})), ...this.state.reports];
    allItems.forEach(i => {
      if(i.tipo === 'congestion') cCong++; else if(i.tipo === 'accidente') cAcc++; else cPar++;
    });

    if(this.chartInstance) this.chartInstance.destroy();
    const ctx = document.getElementById('chartType').getContext('2d');
    this.chartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Tráfico', 'Accidente', 'Otros'],
        datasets: [{ data: [cCong, cAcc, cPar], backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#94a3b8' } } } }
    });

    // Barras de densidad simuladas
    document.getElementById('avenueBars').innerHTML = `
      <div style="margin-bottom:12px">
         <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px"><span>Av. Ferrocarril</span><span>85%</span></div>
         <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px"><div style="width:85%;height:100%;background:#ef4444;border-radius:4px"></div></div>
      </div>
       <div style="margin-bottom:12px">
         <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px"><span>Av. San Carlos</span><span>65%</span></div>
         <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px"><div style="width:65%;height:100%;background:#f59e0b;border-radius:4px"></div></div>
      </div>
       <div>
         <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px"><span>Calle Real</span><span>40%</span></div>
         <div style="height:8px;background:rgba(255,255,255,0.1);border-radius:4px"><div style="width:40%;height:100%;background:#3b82f6;border-radius:4px"></div></div>
      </div>
    `;
    document.getElementById('liveReports').textContent = allItems.length;
  }

  // --- UI HELPERS ---
  // --- UI HELPERS ---
  initUI() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
    });

    document.getElementById('btnHeat').addEventListener('click', (e) => {
      this.state.heatOn = !this.state.heatOn;
      this.state.heatOn ? this.layers.heat.addTo(this.map) : this.layers.heat.remove();
      e.currentTarget.classList.toggle('active', this.state.heatOn);
    });

    document.getElementById('btnLocate').addEventListener('click', () => {
       this.map.setView([-12.068, -75.210], 15);
    });
  
    document.getElementById('btnClearRoute').addEventListener('click', () => this.clearRoute());

    // 🔥 Reportes con Firestore
    document.getElementById('reportForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const ubi = document.getElementById('r_ubicacion').value;
      const tipo = document.querySelector('input[name="tipo"]:checked').value;
      const desc = document.getElementById('r_desc').value;

      const reporte = {
        ubicacion: ubi,
        tipo,
        desc,
        fecha: new Date().toISOString()
      };

      await addDoc(collection(db, "reportes"), reporte);

      this.state.reports.unshift(reporte);
      localStorage.setItem('th_reports_final', JSON.stringify(this.state.reports));

      this.showToast("📡 Reporte enviado a la nube con éxito", "success");
      this.renderMapElements();
      this.updateStats();
      e.target.reset();
    });
  }

  // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
  //   🔹 Aquí cerramos métodos y clase correctamente
  // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
  }

  showToast(msg, type) {
   const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    if(type === 'error') t.style.borderLeftColor = '#ef4444';
    if(type === 'success') t.style.borderLeftColor = '#10b981';
    container.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  } // 🔥 cierre de class TrafficApp
