# Secretaria Web - Obras Sociales

Panel interno para revisar solicitudes cargadas desde la app.

## Que hace

- Lee la coleccion `obra_social_solicitudes` de Firestore.
- Ordena las solicitudes por prioridad y fecha de practica.
- Permite filtrar por estado y buscar por socio, matricula, doctor o ID.
- Muestra vista previa de PDF o imagen.
- Permite cambiar el estado del tramite.
- Permite agregar notas internas al historial.
- Muestra si el PDF unificado esta pendiente, listo o con error.

## Ejecutar local

Desde esta carpeta:

```bash
python3 -m http.server 5174 --bind 127.0.0.1
```

Abrir:

```text
http://127.0.0.1:5174
```

## Login

La app usa Firebase Auth con email y contraseña. Crear los usuarios de
secretaria desde Firebase Console > Authentication.

Si todavia no queres usar login para una prueba local, en `config.js` se puede
cambiar temporalmente:

```js
authRequired: false
```

No dejar esa opcion desactivada en produccion.

## Estados usados

- `recibido`
- `revision_secretaria`
- `revision_auditor`
- `revision_medico`
- `listo_para_cargar`
- `cargado`
- `observado`
- `error_upload`

## Pendiente para la proxima etapa

- Cloud Function o Cloud Run para unificar PDFs e imagenes en un solo PDF.
- OCR/extraccion automatica con puntaje de confianza.
- Fallback automatico a revision manual si el formato del sanatorio cambia.
- Reglas de Firestore/Storage por rol de secretaria/auditor/medico.
