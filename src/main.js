class Runner {
    constructor() {
        // DOM elements
        this.canvas = document.getElementById('gameCanvas');
        this.frame = document.getElementById('grid-frame');
        this.wrapper = document.getElementById('canvas-wrapper');
        this.ctx = this.canvas.getContext('2d');
        this.playPauseButton = document.getElementById('playpause-button');
        this.resetButton = document.getElementById('reset-button');
        this.epochInput = document.getElementById('epoch');
        this.epochValue = document.getElementById('epoch-value');
        this.heatMapToggle = document.getElementById('heatmap-toggle');
        this.animateToggle = document.getElementById('animate-toggle');
        this.gridModeSelect = document.getElementById('grid-mode');
        this.optionsDropdown = document.querySelector('.options-dropdown');
        this.optionsButton = document.getElementById('options-button');
        // Simulation parameters
        this.epochSliderSteps = [25, 50, 100, 150, 250, 300, 600, 1000, 1500, 2000];
        this.epochSliderLabels = [
            '25ms', '50ms', '100ms', '150ms', '250ms', '300ms', '600ms', '1s', '1.5s', "2s"
        ];
        this.cellSize = 10;
        // Grid state
        this.grid = [];
        this.nextGrid = []; // secondary buffer to keep typed arrays and avoid JSON diff
        this.deathCounts = [];
        // Simulation state
        this.intervalId = null;
        this.isRunning = false;
        this.isPaused = false;
        this.isMouseDown = false;
        this.paintedCells = new Set();
        this.previewCells = new Set();
        this.heatMap = this.heatMapToggle ? this.heatMapToggle.checked : true;
        this.animationsEnabled = this.animateToggle ? this.animateToggle.checked : true;
        const initialGridMode = this.gridModeSelect ? this.gridModeSelect.value : 'fixed';
        this.toroidal = initialGridMode === 'toroidal';
        this.infinite = initialGridMode === 'infinite';
        // Initialize epoch from control's current value/index
        this.epochDuration = this.epochSliderSteps[parseInt(this.epochInput.value || 100)];
        this.lastPaintedCell = null;
        this.mouseDownCell = null;
        this.minCellSize = 2;
        this.maxCellSize = 40;
        this.imageData = null; // reused pixel buffer for batch drawing
        this.showGridLines = false; // disable grid lines (invisible)
        // Animation state
        this.transitions = new Map(); // key: "r,c" -> { type: 'birth'|'death', start: number }
        this.animationRafId = null;
        this.animationDuration = 140; // ms (will be adjusted dynamically)
        this.minAnimatedCellSize = 6; // only animate when cell is large enough to see
        this.minAnimatedEpochMs = 100; // disable animations when epoch < 100ms
    }

    // --- UI/DOM Methods ---
    run() {
        this.initEpochSlider();
        this.fitGridToContainer();
        this.attachEventListeners();
        this.adjustAnimationDuration();
        this.drawGrid();
    }

    initEpochSlider() {
        // Set up the epoch control (supports select or range)
        if (!this.epochInput) return;
        if (this.epochInput.tagName && this.epochInput.tagName.toLowerCase() === 'select') {
            // Populate options
            this.epochInput.innerHTML = '';
            this.epochSliderSteps.forEach((ms, idx) => {
                const opt = document.createElement('option');
                opt.value = String(idx);
                opt.textContent = this.epochSliderLabels[idx];
                this.epochInput.appendChild(opt);
            });
            // Default selection
            if (this.epochInput.selectedIndex === -1) {
                this.epochInput.selectedIndex = 5; // 300ms as in original value
            }
            if (this.epochValue) this.epochValue.textContent = this.epochSliderLabels[this.epochInput.value];
        } else if (this.epochInput.type === 'range') {
            this.epochInput.min = 0;
            this.epochInput.max = this.epochSliderSteps.length - 1;
            this.epochInput.step = 1;
            if (!this.epochInput.value) this.epochInput.value = 0; // Default to 0.1s
            if (this.epochValue) this.epochValue.textContent = this.epochSliderLabels[this.epochInput.value];
        }
    }

    updateButtonStates() {
        // Update play/pause/reset button states based on simulation state
        if (!this.isRunning) {
            const icon = document.getElementById('playpause-icon');
            if (icon) icon.src = 'assets/play-button.svg';
            this.playPauseButton.title = 'Start';
            this.playPauseButton.disabled = this.isGridBlank();
        } else if (this.isPaused) {
            const icon = document.getElementById('playpause-icon');
            if (icon) icon.src = 'assets/play-button.svg';
            this.playPauseButton.title = 'Resume';
            this.playPauseButton.disabled = false;
        } else {
            const icon = document.getElementById('playpause-icon');
            if (icon) icon.src = 'assets/pause-button.svg';
            this.playPauseButton.title = 'Pause';
            this.playPauseButton.disabled = false;
        }
        this.resetButton.disabled = !this.isRunning && this.isGridBlank();
    }

    drawGrid(now) {
        // Batch draw using ImageData for performance
        const rows = this.grid.length;
        if (rows === 0) return;
        const cols = this.grid[0].length;
        const width = cols * this.cellSize;
        const height = rows * this.cellSize;
        const nowTs = typeof now === 'number' ? now : (window.performance ? performance.now() : Date.now());
        // Dynamic border thickness: thinner at low zoom, thicker at high zoom
        // 0 for very small cells, up to 3 px for very large cells
        const borderThickness = Math.max(0, Math.min(3, Math.floor(this.cellSize / 9)));

        // Ensure canvas matches grid size
        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;

        // Update wrapper layout so that when canvas is smaller than the viewport it stays centered
        this.updateWrapperLayout();

        // Allocate or resize the ImageData buffer
        if (!this.imageData || this.imageData.width !== width || this.imageData.height !== height) {
            this.imageData = this.ctx.createImageData(width, height);
        }
        const data = this.imageData.data;

        // Fill pixels for each cell block
        for (let r = 0; r < rows; r++) {
            const dr = this.deathCounts[r];
            const gr = this.grid[r];
            const yStart = r * this.cellSize;
            for (let c = 0; c < cols; c++) {
                // Determine color and whether to draw borders
                const alive = gr[c] === 1;
                const heat = this.heatMap && dr[c] > 0;
                const isColored = alive || heat;
                let R, G, B, A = 255;
                if (alive) {
                    R = 255; G = 255; B = 255;
                } else if (heat) {
                    const [hr, hg, hb] = this.getHeatColor(dr[c]);
                    R = hr; G = hg; B = hb;
                } else {
                    R = 0; G = 0; B = 0;
                }

                // Transition handling
                const key = r + ',' + c;
                const canAnimate = this.animationsEnabled && this.cellSize >= this.minAnimatedCellSize && this.epochDuration >= this.minAnimatedEpochMs;
                const trans = canAnimate ? this.transitions.get(key) : undefined;
                let inTransition = false, transType = null, prog = 0;
                if (trans) {
                    const elapsed = nowTs - trans.start;
                    if (elapsed < this.animationDuration && (trans.type === 'birth' || trans.type === 'death')) {
                        inTransition = true;
                        transType = trans.type;
                        prog = Math.max(0, Math.min(1, elapsed / this.animationDuration));
                    } else {
                        // will be cleaned up by RAF loop
                    }
                }

                const xStart = c * this.cellSize;
                const maxD = (this.cellSize - 1) * 2;
                const threshold = Math.floor(prog * maxD);

                // Source/target colors for transition
                // Birth: BL->TR wipe from heat/black to white
                // Death: TR->BL wipe from white to black
                let srcR = 0, srcG = 0, srcB = 0;
                let tgtR = 255, tgtG = 255, tgtB = 255;
                if (inTransition && transType === 'birth') {
                    if (this.heatMap && dr[c] > 0) {
                        const [hr, hg, hb] = this.getHeatColor(dr[c]);
                        srcR = hr; srcG = hg; srcB = hb;
                    } else {
                        srcR = 0; srcG = 0; srcB = 0;
                    }
                    tgtR = 255; tgtG = 255; tgtB = 255;
                } else if (inTransition && transType === 'death') {
                    // from white to heat color when heatmap is on, else to black
                    srcR = 255; srcG = 255; srcB = 255;
                    if (this.heatMap && dr[c] > 0) {
                        const [hr, hg, hb] = this.getHeatColor(dr[c]);
                        tgtR = hr; tgtG = hg; tgtB = hb;
                    } else {
                        tgtR = 0; tgtG = 0; tgtB = 0;
                    }
                }

                // Paint the block (cellSize x cellSize)
                for (let py = 0; py < this.cellSize; py++) {
                    const y = yStart + py;
                    let idx = (y * width + xStart) * 4;
                    // Precompute border flags for this row with variable thickness
                    const drawTop = isColored && borderThickness > 0 && py < borderThickness; // top edge (variable thickness)
                    const drawBottom = isColored && borderThickness > 0 && r === rows - 1 && py >= this.cellSize - borderThickness; // only outer bottom edge
                    for (let px = 0; px < this.cellSize; px++) {
                        // Border: left/top edges for every colored cell; right/bottom only on outermost edges
                        const drawLeft = isColored && borderThickness > 0 && px < borderThickness; // left edge (variable thickness)
                        const drawRight = isColored && borderThickness > 0 && c === cols - 1 && px >= this.cellSize - borderThickness; // only outer right edge
                        const isBorder = drawLeft || drawTop || drawRight || drawBottom;
                        if (isBorder) {
                            // black border pixel
                            data[idx] = 0;
                            data[idx + 1] = 0;
                            data[idx + 2] = 0;
                            data[idx + 3] = 255;
                        } else if (inTransition) {
                            let useTarget = false;
                            if (transType === 'birth') {
                                // BL->TR: bottom-left (px=0, py=cellSize-1) -> 0, top-right -> maxD
                                const d = px + (this.cellSize - 1 - py);
                                useTarget = d <= threshold;
                            } else if (transType === 'death') {
                                // TR->BL: top-right (px=cellSize-1, py=0) -> 0, bottom-left -> maxD
                                const d2 = (this.cellSize - 1 - px) + py;
                                useTarget = d2 <= threshold;
                            }
                            if (useTarget) {
                                data[idx] = tgtR;
                                data[idx + 1] = tgtG;
                                data[idx + 2] = tgtB;
                                data[idx + 3] = 255;
                            } else {
                                data[idx] = srcR;
                                data[idx + 1] = srcG;
                                data[idx + 2] = srcB;
                                data[idx + 3] = 255;
                            }
                        } else {
                            data[idx] = R;
                            data[idx + 1] = G;
                            data[idx + 2] = B;
                            data[idx + 3] = A;
                        }
                        idx += 4;
                    }
                }
            }
        }

        // Put the composed image to the canvas
        this.ctx.putImageData(this.imageData, 0, 0);

        // Overlay preview cells (small count, fine to draw as rects)
        if (this.previewCells.size > 0) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(255,255,255,0.7)';
            for (const key of this.previewCells) {
                const [row, col] = key.split(',').map(Number);
                if (row !== undefined && col !== undefined) {
                    this.ctx.fillRect(col * this.cellSize, row * this.cellSize, this.cellSize, this.cellSize);
                }
            }
            this.ctx.restore();
        }

        // Draw grid lines only if enabled (kept invisible by default)
        if (this.showGridLines) {
            this.ctx.save();
            this.ctx.lineWidth = 1;
            this.ctx.strokeStyle = 'rgba(0,0,0,1)'; // black lines
            this.ctx.beginPath();
            // Vertical lines
            for (let x = 0; x <= cols; x++) {
                const px = Math.floor(x * this.cellSize) + 0.5;
                this.ctx.moveTo(px, 0);
                this.ctx.lineTo(px, height);
            }
            // Horizontal lines
            for (let y = 0; y <= rows; y++) {
                const py = Math.floor(y * this.cellSize) + 0.5;
                this.ctx.moveTo(0, py);
                this.ctx.lineTo(width, py);
            }
            this.ctx.stroke();
            this.ctx.restore();
        }

        this.updateButtonStates();
    }

    updateWrapperLayout() {
        if (!this.wrapper) return;
        const needCenterX = this.canvas.width < this.frame.clientWidth;
        const needCenterY = this.canvas.height < this.frame.clientHeight;
        if (needCenterX || needCenterY) {
            // Center canvas inside frame when it's smaller
            this.wrapper.style.display = 'flex';
            this.wrapper.style.justifyContent = 'center';
            this.wrapper.style.alignItems = 'center';
            this.wrapper.style.width = this.frame.clientWidth + 'px';
            this.wrapper.style.height = this.frame.clientHeight + 'px';
        } else {
            // Anchor to top-left for accurate scroll math
            this.wrapper.style.display = 'inline-block';
            this.wrapper.style.width = 'auto';
            this.wrapper.style.height = 'auto';
        }
    }

    getHeatColor(n) {
        // Map deathCounts to a heat color (replicates previous gradient)
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
        return [rCol, gCol, bCol];
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
        if (this.animateToggle) {
            this.animateToggle.addEventListener('change', () => {
                this.animationsEnabled = this.animateToggle.checked;
                if (!this.animationsEnabled) {
                    // stop RAF and clear transitions
                    if (this.animationRafId != null) {
                        cancelAnimationFrame(this.animationRafId);
                        this.animationRafId = null;
                    }
                    this.transitions.clear();
                }
                this.drawGrid();
            });
        }
        // Options menu open/close behavior for click/touch devices
        if (this.optionsButton && this.optionsDropdown) {
            this.optionsButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isOpen = this.optionsDropdown.classList.contains('open');
                if (isOpen) {
                    this.optionsDropdown.classList.remove('open');
                } else {
                    this.optionsDropdown.classList.add('open');
                }
            });
            // Close menu when clicking outside
            window.addEventListener('click', (e) => {
                if (!this.optionsDropdown.contains(e.target)) {
                    this.optionsDropdown.classList.remove('open');
                }
            });
            // Close on Escape
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.optionsDropdown.classList.remove('open');
                }
            });
        }
        if (this.gridModeSelect) {
            this.gridModeSelect.addEventListener('change', () => {
                const mode = this.gridModeSelect.value;
                this.toroidal = mode === 'toroidal';
                this.infinite = mode === 'infinite';
                this.drawGrid();
            });
        }
        const onEpochChange = () => {
            const idx = parseInt(this.epochInput.value);
            this.epochDuration = this.epochSliderSteps[idx];
            if (this.epochValue) this.epochValue.textContent = this.epochSliderLabels[idx];
            this.adjustAnimationDuration();
            if (this.isRunning && !this.isPaused) {
                clearInterval(this.intervalId);
                this.intervalId = setInterval(() => this.gameLoop(), this.epochDuration);
            }
        };
        this.epochInput.addEventListener('input', onEpochChange);
        this.epochInput.addEventListener('change', onEpochChange);
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
        // Replace canvas mouseup with global mouseup so drawing finalizes even outside the canvas
        window.addEventListener('mouseup', (e) => {
            if (!this.isMouseDown) return;
            this.isMouseDown = false;
            // Toggle single cell if it was a simple click on one cell, even if mouseup is off-canvas
            const isSingleCell = this.previewCells.size === 1 && this.mouseDownCell && this.previewCells.has(this.mouseDownCell.row + ',' + this.mouseDownCell.col);
            if (isSingleCell) {
                const { row, col } = this.mouseDownCell;
                this.grid[row][col] = this.grid[row][col] ? 0 : 1;
            } else {
                this.applyPreviewCells();
            }
            this.previewCells.clear();
            this.paintedCells.clear();
            this.lastPaintedCell = null;
            this.mouseDownCell = null;
            this.drawGrid();
        });
        this.canvas.addEventListener('mouseleave', () => {
            // Do not clear preview when leaving the canvas; keep drawing state so it persists
            // Finalization will occur on global mouseup
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
            // Global zoom with +/- (and numpad +/-), except when typing or with modifiers
            const target = e.target;
            const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
            const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable);
            const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

            if (!hasModifier && !isTyping) {
                if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
                    e.preventDefault();
                    this.zoom(1);
                    return;
                }
                if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
                    e.preventDefault();
                    this.zoom(-1);
                    return;
                }
            }

            // Spacebar play/pause only when canvas/body focused
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
                }
            }
        });
    }

    zoom(direction) {
        // Zoom in or out by changing cell size while keeping viewport centered
        const oldCellSize = this.cellSize;
        const prevScrollLeft = this.frame.scrollLeft;
        const prevScrollTop = this.frame.scrollTop;
        const frameWidth = this.frame.clientWidth;
        const frameHeight = this.frame.clientHeight;

        let changed = false;
        if (direction > 0 && this.cellSize < this.maxCellSize) {
            this.cellSize += 2;
            changed = true;
        } else if (direction < 0 && this.cellSize > this.minCellSize) {
            this.cellSize -= 2;
            changed = true;
        }
        if (!changed) return;

        // Compute scale relative to old size
        const scale = this.cellSize / oldCellSize;

        // Current viewport center in content coordinates
        const centerX = prevScrollLeft + frameWidth / 2;
        const centerY = prevScrollTop + frameHeight / 2;

        // Resize canvas according to new cell size
        const rows = this.grid.length;
        const cols = this.grid[0].length;
        this.canvas.width = cols * this.cellSize;
        this.canvas.height = rows * this.cellSize;

        // Ensure wrapper layout matches new canvas size BEFORE computing new scroll
        this.updateWrapperLayout();

        // Decide target center: when zooming in, center on the live-cells bounding box if any
        let targetCenterX = null;
        let targetCenterY = null;
        if (direction > 0) {
            // Find bounding box of alive cells
            let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
            const rows = this.grid.length;
            const cols = this.grid[0].length;
            for (let r = 0; r < rows; r++) {
                const gr = this.grid[r];
                for (let c = 0; c < cols; c++) {
                    if (gr[c] === 1) {
                        if (r < minR) minR = r;
                        if (r > maxR) maxR = r;
                        if (c < minC) minC = c;
                        if (c > maxC) maxC = c;
                    }
                }
            }
            if (minR !== Infinity) {
                // Convert bbox center to pixel coordinates with new cell size
                targetCenterX = ((minC + maxC + 1) * this.cellSize) / 2;
                targetCenterY = ((minR + maxR + 1) * this.cellSize) / 2;
            }
        }

        // Compute new scroll positions
        let newScrollLeft, newScrollTop;
        if (targetCenterX != null && targetCenterY != null) {
            // Center around live cells bbox
            newScrollLeft = targetCenterX - frameWidth / 2;
            newScrollTop = targetCenterY - frameHeight / 2;
        } else {
            // Keep previous content center stable
            const newCenterX = centerX * scale;
            const newCenterY = centerY * scale;
            newScrollLeft = newCenterX - frameWidth / 2;
            newScrollTop = newCenterY - frameHeight / 2;
        }

        // Clamp within bounds
        const maxScrollLeft = Math.max(0, this.canvas.width - frameWidth);
        const maxScrollTop = Math.max(0, this.canvas.height - frameHeight);
        newScrollLeft = Math.max(0, Math.min(newScrollLeft, maxScrollLeft));
        newScrollTop = Math.max(0, Math.min(newScrollTop, maxScrollTop));

        this.frame.scrollLeft = newScrollLeft;
        this.frame.scrollTop = newScrollTop;

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
        this.nextGrid = Array.from({ length: rows }, () => new Uint8Array(cols));
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
        // Ensure nextGrid matches current grid dimensions (allocate on first run or after expansion)
        const rows = this.grid.length;
        const cols = this.grid[0].length;
        if (!this.nextGrid || this.nextGrid.length !== rows || this.nextGrid[0].length !== cols) {
            this.nextGrid = Array.from({ length: rows }, () => new Uint8Array(cols));
        }
        let changed = false;
        const nowTs = window.performance ? performance.now() : Date.now();
        for (let r = 0; r < rows; r++) {
            const nextRow = this.nextGrid[r];
            const currRow = this.grid[r];
            for (let c = 0; c < cols; c++) {
                const aliveNeighbors = this.countAliveNeighbors(r, c);
                const curr = currRow[c];
                let next;
                if (curr === 1) {
                    if (aliveNeighbors < 2 || aliveNeighbors > 3) {
                        next = 0;
                        this.deathCounts[r][c] += 1; // increment heat/death count on death
                    } else {
                        next = 1;
                    }
                } else {
                    next = (aliveNeighbors === 3) ? 1 : 0;
                }
                nextRow[c] = next;
                if (next !== curr) {
                    changed = true;
                    // Animate births and deaths
                    if (next === 1) {
                        const key = r + ',' + c;
                        this.transitions.set(key, { type: 'birth', start: nowTs });
                    } else {
                        // set death transition
                        const key = r + ',' + c;
                        this.transitions.set(key, { type: 'death', start: nowTs });
                    }
                }
            }
        }
        return changed;
    }

    isAliveNextEpoch(row, col) {
        // Returns true if a dead cell at (row,col) would become alive in the next epoch
        // Only for non-toroidal mode, so out-of-bounds neighbors are dead
        const numRows = this.grid.length;
        const numCols = this.grid[0].length;
        let aliveNeighbors = 0;
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
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
            [0, -1], [0, 1],
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
        const changed = this.updateGrid();
        if (changed) {
            // swap buffers
            const tmp = this.grid;
            this.grid = this.nextGrid;
            this.nextGrid = tmp;
            this.drawGrid();
            // Start animations if any
            if (this.transitions.size > 0) {
                const canAnimate = this.animationsEnabled && this.cellSize >= this.minAnimatedCellSize && this.epochDuration >= this.minAnimatedEpochMs;
                if (canAnimate) {
                    this.ensureAnimationRunning();
                } else {
                    // Too small or too fast or disabled; clear transitions
                    this.transitions.clear();
                }
            }
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

    ensureAnimationRunning() {
        if (this.animationRafId != null) return;
        const step = (timestamp) => this.animateFrame(timestamp);
        this.animationRafId = requestAnimationFrame(step);
    }

    adjustAnimationDuration() {
        // Make animation proportional to epoch duration, with bounds
        // Use about 70% of the epoch for the wipe, capped to [120ms, 600ms]
        const base = Math.round(this.epochDuration * 0.4);
        this.animationDuration = Math.max(120, Math.min(600, base));
        // If epoch is too fast, disable any active transitions
        if (this.epochDuration < this.minAnimatedEpochMs || !this.animationsEnabled) {
            if (this.animationRafId != null) {
                cancelAnimationFrame(this.animationRafId);
                this.animationRafId = null;
            }
            this.transitions.clear();
        }
    }

    animateFrame(timestamp) {
        // Draw with current timestamp for smooth progress
        this.drawGrid(timestamp);
        // Prune finished transitions
        let anyActive = false;
        for (const [key, tr] of this.transitions) {
            if (timestamp - tr.start >= this.animationDuration) {
                this.transitions.delete(key);
            } else {
                anyActive = true;
            }
        }
        if (anyActive) {
            this.animationRafId = requestAnimationFrame((t) => this.animateFrame(t));
        } else {
            this.animationRafId = null;
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    conway = new Runner();
    conway.run();
});