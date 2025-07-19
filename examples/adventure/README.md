# 3D Adventure Template

Base template for Adventure games made on Rosebud utilizing the roseblox game engine.

## Development

### Serve using basic Python webserver

```bash
python3 -m http.server 8001
# navigate to localhost:8001 in your preferred browser
```

### Building the Game Engine

If you make changes to the game engine, rebuild it. It's symlinked in the current directory.

```bash
cd ../../
npm run build:all
```

This will update the built engine files that the Adventure template uses.
