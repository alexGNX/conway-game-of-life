# Conway's Game of Life

Game of Life is a famous cellular automaton devised by British mathematician John Conway. It consists of a grid of cells, each of which can be either alive or dead. At each step, the state of every cell is updated simultaneously according to a simple set of rules:

- A live cell with two or three live neighbors survives.
- A live cell with fewer than two or more than three live neighbors dies.
- A dead cell with exactly three live neighbors becomes alive.

![Overview](res/overview.gif)

## Project Structure

```
conway-game-of-life/
├── src/
│   ├── index.html
│   ├── style.css
│   └── main.js
├── LICENSE  
└── README.md            
```

## Features

### Core Functionality

- **Interactive Cell Painting**: Click and drag to draw patterns on the grid
- **Grid Modes**: 
  - Standard finite grid
  - Toroidal grid for seamless boundaries
  - Infinite grid that expands dynamically as patterns grow

### Visualization
- **Heat Map**: Visual representation of grid cells activity frequency with color gradients
- **Zoom**: Keyboard controls (+/-) for zooming in/out

### User Controls
- **Speed Control**: Adjustable epoch duration slider
- **Keyboard Shortcuts**: Spacebar for play/pause, +/- for zoom

## Serve

You can serve the application using Python:

```bash
cd src/ && python3 -m http.server 8000
```

Then navigate to `http://localhost:8000` in your browser.

**Alternatively, simply open `src/index.html` directly in your browser.**

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.