class Runner {
    constructor() {
        // DOM elements
        this.canvas = document.getElementById('gameCanvas');
        this.frame = document.getElementById('grid-frame');
        this.ctx = this.canvas.getContext('2d');
        this.playPauseButton = document.getElementById('playpause-button');
        this.resetButton = document.getElementById('reset-button');
        this.epochInput = document.getElementById('epoch');
        this.epochValue = document.getElementById('epoch-value');
        this.heatMapToggle = document.getElementById('heatmap-toggle');
        this.toroidalToggle = document.getElementById('toroidal-toggle');
        this.infiniteToggle = document.getElementById('infinite-toggle');
        // Simulation parameters
        this.epochSliderSteps = [25, 50, 100, 150, 250, 300, 600, 1000];
        this.epochSliderLabels = [
            '25ms', '50ms', '100ms', '150ms', '250ms', '300ms', '600ms', '1s'
        ];
        this.cellSize = 10;
        // Grid state
        this.grid = [];
        this.deathCounts = [];
        // Simulation state
        this.intervalId = null;
        this.isRunning = false;
        this.isPaused = false;
        this.isMouseDown = false;
        this.paintedCells = new Set();
        this.previewCells = new Set();
        this.heatMap = this.heatMapToggle ? this.heatMapToggle.checked : true;
        this.toroidal = this.toroidalToggle ? this.toroidalToggle.checked : true;
        this.infinite = this.infiniteToggle ? this.infiniteToggle.checked : false;
        this.epochDuration = this.epochSliderSteps[this.epochInput.value];
        this.lastPaintedCell = null;
        this.mouseDownCell = null;
        this.minCellSize = 2;
        this.maxCellSize = 40;
    }

    // --- UI/DOM Methods ---
    run() {
        this.initEpochSlider();
        this.fitGridToContainer();
        this.attachEventListeners();
        this.drawGrid();
    }

    initEpochSlider() {
        // Set up the epoch duration slider
        if (this.epochInput && this.epochInput.type === 'range') {
            this.epochInput.min = 0;
            this.epochInput.max = this.epochSliderSteps.length - 1;
            this.epochInput.step = 1;
            if (!this.epochInput.value) this.epochInput.value = 0; // Default to 0.1s
            this.epochValue.textContent = this.epochSliderLabels[this.epochInput.value];
        }
    }

    updateButtonStates() {
        // Update play/pause/reset button states based on simulation state
        if (!this.isRunning) {
            this.playPauseButton.textContent = 'Start';
            this.playPauseButton.disabled = this.isGridBlank();
        } else if (this.isPaused) {
            this.playPauseButton.textContent = 'Resume';
            this.playPauseButton.disabled = false;
        } else {
            this.playPauseButton.textContent = 'Pause';
            this.playPauseButton.disabled = false;
        }
        this.resetButton.disabled = !this.isRunning && this.isGridBlank();
    }

    drawGrid() {
        // Draw the entire grid and all cells
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for (let r = 0; r < this.grid.length; r++) {
            for (let c = 0; c < this.grid[r].length; c++) {
                let isPreview = this.previewCells.has(r + ',' + c);
                // Preview cells (mouse hover/drag)
                if (isPreview) {
                    this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
                } else if (this.grid[r][c] === 1) {
                    // Alive cell
                    this.ctx.fillStyle = 'white';
                } else if (this.heatMap && this.deathCounts[r][c] > 0) {
                    // Dead cell with heatmap
                    const n = this.deathCounts[r][c];
                    let rCol, gCol, bCol;
                    if (n <= 6) {
                        rCol = 20 + n * 10;
                        gCol = 40 + n * 20;
                        bCol = 120 + n * 20;
                    } else if (n <= 12) {
                        const t = (n - 6) / 6;
                        rCol = Math.round((80 * (1 - t)) + (255 * t));
                        gCol = Math.round((160 * (1 - t)) + (120 * t));
                        bCol = Math.round((240 * (1 - t)) + (200 * t));
                    } else if (n <= 18) {
                        const t = (n - 12) / 6;
                        rCol = Math.round((255 * (1 - t)) + (180 * t));
                        gCol = Math.round((120 * (1 - t)) + (30 * t));
                        bCol = Math.round((200 * (1 - t)) + (60 * t));
                    } else {
                        rCol = 120;
                        gCol = 20;
                        bCol = 40;
                    }
                    this.ctx.fillStyle = `rgb(${rCol},${gCol},${bCol})`;
                } else {
                    // Dead cell
                    this.ctx.fillStyle = 'black';
                }
                this.ctx.fillRect(c * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize);
                this.ctx.strokeRect(c * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize);
            }
        }
        this.ctx.lineWidth = 1;
        this.updateButtonStates();
    }

    attachEventListeners() {
        // Attach all UI and mouse/keyboard event listeners
        this.playPauseButton.addEventListener('click', () => {
            if (!this.isRunning) {
                this.startGame();
            } else if (this.isPaused) {
                this.resumeGame();
            } else {
                this.pauseGame();
            }
        });
        this.resetButton.addEventListener('click', () => this.resetGame());
        if (this.heatMapToggle) {
            this.heatMapToggle.addEventListener('change', () => {
                this.heatMap = this.heatMapToggle.checked;
                this.drawGrid();
            });
        }
        if (this.toroidalToggle) {
            this.toroidalToggle.addEventListener('change', () => {
                this.toroidal = this.toroidalToggle.checked;
                if (this.toroidal) {
                    this.infinite = false;
                    if (this.infiniteToggle) this.infiniteToggle.checked = false;
                }
                this.drawGrid();
            });
        }
        if (this.infiniteToggle) {
            this.infiniteToggle.addEventListener('change', () => {
                this.infinite = this.infiniteToggle.checked;
                if (this.infinite) {
                    this.toroidal = false;
                    if (this.toroidalToggle) this.toroidalToggle.checked = false;
                }
            });
        }
        this.epochInput.addEventListener('input', () => {
            const idx = parseInt(this.epochInput.value);
            this.epochDuration = this.epochSliderSteps[idx];
            this.epochValue.textContent = this.epochSliderLabels[idx];
            if (this.isRunning && !this.isPaused) {
                clearInterval(this.intervalId);
                this.intervalId = setInterval(() => this.gameLoop(), this.epochDuration);
            }
        });
        // Mouse events for painting cells
        this.canvas.addEventListener('mousedown', (e) => {
            this.isMouseDown = true;
            this.paintedCells.clear();
            this.previewCells.clear();
            this.lastPaintedCell = this.getCellFromEvent(e);
            this.mouseDownCell = this.lastPaintedCell;
            this.previewCellFromEvent(e);
            this.drawGrid();
        });
        this.canvas.addEventListener('mouseup', (e) => {
            this.isMouseDown = false;
            const mouseUpCell = this.getCellFromEvent(e);
            // If only one cell was painted, toggle it
            if (
                this.mouseDownCell && mouseUpCell &&
                this.mouseDownCell.row === mouseUpCell.row &&
                this.mouseDownCell.col === mouseUpCell.col &&
                this.previewCells.size === 1
            ) {
                const key = this.mouseDownCell.row + ',' + this.mouseDownCell.col;
                this.grid[this.mouseDownCell.row][this.mouseDownCell.col] = this.grid[this.mouseDownCell.row][this.mouseDownCell.col] ? 0 : 1;
            } else {
                // Otherwise, apply all preview cells as alive
                this.applyPreviewCells();
            }
            this.previewCells.clear();
            this.paintedCells.clear();
            this.lastPaintedCell = null;
            this.mouseDownCell = null;
            this.drawGrid();
        });
        this.canvas.addEventListener('mouseleave', () => {
            this.isMouseDown = false;
            this.previewCells.clear();
            this.paintedCells.clear();
            this.lastPaintedCell = null;
            this.drawGrid();
        });
        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.isMouseDown) return;
            const currentCell = this.getCellFromEvent(e);
            if (this.lastPaintedCell && currentCell.row !== undefined) {
                this.paintLineBetweenCells(this.lastPaintedCell, currentCell);
                this.lastPaintedCell = currentCell;
                this.drawGrid();
            }
        });
        // Keyboard events for controls and zoom
        this.canvas.setAttribute('tabindex', 0);
        window.addEventListener('keydown', (e) => {
            if (document.activeElement === this.canvas || e.target === document.body) {
                if (e.code === 'Space' || e.key === ' ') {
                    e.preventDefault();
                    if (!this.isRunning) {
                        this.startGame();
                    } else if (this.isPaused) {
                        this.resumeGame();
                    } else if (this.isRunning) {
                        this.pauseGame();
                    }
                } else if (e.key === '+' || e.key === '=') {
                    this.zoom(1);
                } else if (e.key === '-' || e.key === '_') {
                    this.zoom(-1);
                }
            }
        });
    }

    zoom(direction) {
        // Zoom in or out by changing cell size
        const oldCellSize = this.cellSize;
        if (direction > 0 && this.cellSize < this.maxCellSize) {
            this.cellSize += 2;
        } else if (direction < 0 && this.cellSize > this.minCellSize) {
            this.cellSize -= 2;
        } else {
            return;
        }
        // Resize canvas and redraw grid
        const rows = this.grid.length;
        const cols = this.grid[0].length;
        this.canvas.width = cols * this.cellSize;
        this.canvas.height = rows * this.cellSize;
        this.drawGrid();
    }

    fitGridToContainer() {
        // Fit the grid to the container size and create a new grid
        const frameWidth = this.frame.clientWidth;
        const frameHeight = this.frame.clientHeight;
        const cols = Math.floor(frameWidth / this.cellSize);
        const rows = Math.floor(frameHeight / this.cellSize);
        this.createGrid(rows, cols);
        this.canvas.width = cols * this.cellSize;
        this.canvas.height = rows * this.cellSize;
    }

    // --- Grid/Simulation Methods ---
    createGrid(rows, cols) {
        // Create a new grid and deathCounts using typed arrays
        this.grid = Array.from({ length: rows }, () => new Uint8Array(cols));
        this.deathCounts = Array.from({ length: rows }, () => new Uint16Array(cols));
    }

    isGridBlank() {
        // Check if all cells are dead
        return this.grid.every(row => row.every(cell => cell === 0));
    }

    updateGrid() {
        // Update the grid for the next generation
        // Only expand if infinite is enabled (and not toroidal, enforced by toggle exclusivity)
        if (this.infinite) {
            let expandTop = false, expandBottom = false, expandLeft = false, expandRight = false;
            const numRows = this.grid.length;
            const numCols = this.grid[0].length;
            // Check if we need to expand in any direction
            for (let c = 0; c < numCols; c++) {
                if (this.isAliveNextEpoch(-1, c)) expandTop = true;
            }
            for (let c = 0; c < numCols; c++) {
                if (this.isAliveNextEpoch(numRows, c)) expandBottom = true;
            }
            for (let r = 0; r < numRows; r++) {
                if (this.isAliveNextEpoch(r, -1)) expandLeft = true;
            }
            for (let r = 0; r < numRows; r++) {
                if (this.isAliveNextEpoch(r, numCols)) expandRight = true;
            }
            if (expandTop) this.expandGrid('top', 10);
            if (expandBottom) this.expandGrid('bottom', 10);
            if (expandLeft) this.expandGrid('left', 10);
            if (expandRight) this.expandGrid('right', 10);
        }
        // Now update as usual
        const newGrid = this.grid.map(arr => [...arr]);
        const nextDeathCounts = this.deathCounts.map(arr => [...arr]);
        for (let r = 0; r < this.grid.length; r++) {
            for (let c = 0; c < this.grid[r].length; c++) {
                const aliveNeighbors = this.countAliveNeighbors(r, c);
                if (this.grid[r][c] === 1) {
                    if (aliveNeighbors < 2 || aliveNeighbors > 3) {
                        newGrid[r][c] = 0;
                        nextDeathCounts[r][c] += 1;
                    } else {
                        newGrid[r][c] = 1;
                    }
                } else {
                    if (aliveNeighbors === 3) {
                        newGrid[r][c] = 1;
                    } else {
                        newGrid[r][c] = 0;
                    }
                }
            }
        }
        this.deathCounts = nextDeathCounts;
        return newGrid;
    }

    isAliveNextEpoch(row, col) {
        // Returns true if a dead cell at (row,col) would become alive in the next epoch
        // Only for non-toroidal mode, so out-of-bounds neighbors are dead
        const numRows = this.grid.length;
        const numCols = this.grid[0].length;
        let aliveNeighbors = 0;
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],          [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];
        for (const [dx, dy] of directions) {
            const nRow = row + dx;
            const nCol = col + dy;
            if (nRow >= 0 && nRow < numRows && nCol >= 0 && nCol < numCols) {
                aliveNeighbors += this.grid[nRow][nCol];
            }
        }
        // Only dead cells can be born
        return aliveNeighbors === 3;
    }

    countAliveNeighbors(row, col) {
        // Count the number of alive neighbors for a cell
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],          [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];
        let count = 0;
        const numRows = this.grid.length;
        const numCols = this.grid[0].length;
        directions.forEach(([dx, dy]) => {
            let newRow = row + dx;
            let newCol = col + dy;
            if (this.toroidal) {
                // Wrap around for toroidal mode
                newRow = (newRow + numRows) % numRows;
                newCol = (newCol + numCols) % numCols;
                count += this.grid[newRow][newCol];
            } else {
                if (newRow >= 0 && newRow < numRows && newCol >= 0 && newCol < numCols) {
                    count += this.grid[newRow][newCol];
                }
            }
        });
        return count;
    }

    expandGrid(direction, amount) {
        // Expand the grid in the specified direction by the given amount
        const numRows = this.grid.length;
        const numCols = this.grid[0].length;
        if (direction === 'top') {
            for (let i = 0; i < amount; i++) {
                this.grid.unshift(new Uint8Array(numCols));
                this.deathCounts.unshift(new Uint16Array(numCols));
            }
        } else if (direction === 'bottom') {
            for (let i = 0; i < amount; i++) {
                this.grid.push(new Uint8Array(numCols));
                this.deathCounts.push(new Uint16Array(numCols));
            }
        } else if (direction === 'left') {
            for (let r = 0; r < this.grid.length; r++) {
                const newRow = new Uint8Array(numCols + amount);
                const newDeaths = new Uint16Array(numCols + amount);
                newRow.set(this.grid[r], amount);
                newDeaths.set(this.deathCounts[r], amount);
                this.grid[r] = newRow;
                this.deathCounts[r] = newDeaths;
            }
        } else if (direction === 'right') {
            for (let r = 0; r < this.grid.length; r++) {
                const newRow = new Uint8Array(numCols + amount);
                const newDeaths = new Uint16Array(numCols + amount);
                newRow.set(this.grid[r], 0);
                newDeaths.set(this.deathCounts[r], 0);
                this.grid[r] = newRow;
                this.deathCounts[r] = newDeaths;
            }
        }
        // Update canvas size to match new grid dimensions
        this.canvas.width = this.grid[0].length * this.cellSize;
        this.canvas.height = this.grid.length * this.cellSize;
        // Adjust scroll position to keep view stable when expanding top/left
        if (direction === 'top') {
            this.frame.scrollTop += amount * this.cellSize;
        }
        if (direction === 'left') {
            this.frame.scrollLeft += amount * this.cellSize;
        }
    }

    gameLoop() {
        // Main simulation loop: update grid and redraw
        const newGrid = this.updateGrid();
        if (JSON.stringify(newGrid) !== JSON.stringify(this.grid)) {
            this.grid = newGrid;
            this.drawGrid();
        } else {
            clearInterval(this.intervalId);
            this.isRunning = false;
            this.updateButtonStates();
        }
    }

    paintLineBetweenCells(cellA, cellB) {
        // Bresenham's line algorithm for painting between two cells
        let x0 = cellA.col, y0 = cellA.row;
        let x1 = cellB.col, y1 = cellB.row;
        let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        let sx = x0 < x1 ? 1 : -1;
        let sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        while (true) {
            const key = y0 + ',' + x0;
            if (!this.paintedCells.has(key)) {
                this.previewCells.add(key);
                this.paintedCells.add(key);
            }
            if (x0 === x1 && y0 === y1) break;
            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    getCellFromEvent(e) {
        // Convert mouse event to grid cell coordinates
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        const col = Math.floor(x / this.cellSize);
        const row = Math.floor(y / this.cellSize);
        if (row >= 0 && row < this.grid.length && col >= 0 && col < this.grid[0].length) {
            return { row, col };
        }
        return { row: undefined, col: undefined };
    }

    previewCellFromEvent(e) {
        // Add a cell to the preview set when painting
        if (e.button !== undefined && e.button !== 0) return;
        const { row, col } = this.getCellFromEvent(e);
        if (row === undefined || col === undefined) return;
        const key = row + ',' + col;
        if (this.paintedCells.has(key)) return;
        this.previewCells.add(key);
        this.paintedCells.add(key);
    }

    applyPreviewCells() {
        // Set all previewed cells to alive
        for (const key of this.previewCells) {
            const [row, col] = key.split(',').map(Number);
            if (row !== undefined && col !== undefined) {
                this.grid[row][col] = 1;
            }
        }
    }

    // --- Game Control Methods ---
    startGame() {
        // Start the simulation
        this.isRunning = true;
        this.isPaused = false;
        this.updateButtonStates();
        this.intervalId = setInterval(() => this.gameLoop(), this.epochDuration);
    }

    pauseGame() {
        // Pause the simulation
        if (!this.isRunning) return;
        this.isPaused = true;
        clearInterval(this.intervalId);
        this.updateButtonStates();
    }

    resumeGame() {
        // Resume the simulation
        if (!this.isRunning) return;
        this.isPaused = false;
        this.intervalId = setInterval(() => this.gameLoop(), this.epochDuration);
        this.updateButtonStates();
    }

    resetGame() {
        // Reset the simulation and grid
        clearInterval(this.intervalId);
        this.isRunning = false;
        this.isPaused = false;
        this.fitGridToContainer(); // Recreate grid to fit container
        this.drawGrid();
        this.updateButtonStates();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    conway = new Runner();
    conway.run();
});