const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;
const appWindow = window.__TAURI__.window.appWindow;
document.addEventListener('DOMContentLoaded', async () => {
    console.log("App initialized with Tauri 2.0");

    const urlInput = document.getElementById('url-input');
    const pasteUrlBtn = document.getElementById('paste-url-btn');
    const outputDirInput = document.getElementById('output-dir');
    const browseButton = document.getElementById('browse-button');
    const downloadButton = document.getElementById('download-button');
    const cancelButton = document.getElementById('cancel-button');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const progressSpeed = document.getElementById('progress-speed');
    const progressEta = document.getElementById('progress-eta');
    const filename = document.getElementById('filename');
    const minimizeBtn = document.querySelector('.fa-minus')?.parentElement;
    const maximizeBtn = document.querySelector('.fa-square')?.parentElement;
    const closeBtn = document.querySelector('.fa-xmark')?.parentElement;

    let isDownloading = false;
    let progressInterval;
    let unlistenFn = null;

    initWindowControls();

    if (pasteUrlBtn) {
        pasteUrlBtn.addEventListener('click', async () => {
            try {
                const clipboardText = await navigator.clipboard.readText();
                if (clipboardText && isValidYoutubeUrl(clipboardText)) {
                    urlInput.value = clipboardText;
                } else {
                    showToast ? showToast('Invalid YouTube URL in clipboard') : 
                                alert('Invalid YouTube URL in clipboard');
                }
            } catch (err) {
                console.error("Failed to read clipboard:", err);
                showToast ? showToast('Failed to read clipboard') : 
                            alert('Failed to read clipboard');
            }
        });
    }

    browseButton.addEventListener('click', async () => {
        try {
            console.log("Opening directory dialog");
            const selected = await open({
                directory: true,
                multiple: false,
                title: 'Select Output Directory'
            });

            if (selected) {
                console.log("Selected directory:", selected);
                outputDirInput.value = selected;
            }
        } catch (error) {
            console.error('Error selecting directory:', error);
            showToast ? showToast('Failed to select directory') : 
                        alert('Failed to select directory: ' + error);
        }
    });

    downloadButton.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showToast ? showToast('Please enter a YouTube URL') : 
                        alert('Please enter a YouTube URL');
            return;
        }

        if (!isValidYoutubeUrl(url)) {
            showToast ? showToast('Please enter a valid YouTube URL') : 
                        alert('Please enter a valid YouTube URL');
            return;
        }

        const format = document.querySelector('input[name="format"]:checked').value;

        const quality = document.querySelector('input[name="quality"]:checked')?.value || 'best';
        const outputDir = outputDirInput.value || null;

        try {
            isDownloading = true;
            downloadButton.disabled = true;
            if (downloadButton.classList) {
                downloadButton.classList.add('opacity-50');
            }
            progressContainer.classList.remove('hidden');

            startProgressTracking();

            if (typeof updateFooterStatus === 'function') {
                updateFooterStatus('Capturing video...');
            }

            console.log("Starting download with options:", { url, format, quality, outputDir });
            const result = await invoke('download_video', {
                options: {
                    url,
                    format,
                    quality,
                    output_dir: outputDir  
                }
            });

            stopProgressTracking();
            console.log("Download result:", result);

            if (typeof showToast === 'function') {
                showToast(result);
                if (typeof addToDownloadHistory === 'function') {
                    addToDownloadHistory({
                        title: filename.textContent.replace('File: ', ''),
                        format,
                        url
                    });
                }
            } else {
                alert(result);
            }
        } catch (error) {
            console.error("Download error:", error);
            showToast ? showToast(`Error: ${error}`) : 
                        alert(`Error: ${error}`);
        } finally {
            isDownloading = false;
            downloadButton.disabled = false;
            if (downloadButton.classList) {
                downloadButton.classList.remove('opacity-50');
            }
            progressContainer.classList.add('hidden');
            resetProgress();
        }
    });

    cancelButton.addEventListener('click', async () => {
        if (isDownloading) {
            try {
                await invoke('cancel_download');
                stopProgressTracking();
                isDownloading = false;
                downloadButton.disabled = false;
                if (downloadButton.classList) {
                    downloadButton.classList.remove('opacity-50');
                }
                progressContainer.classList.add('hidden');
                resetProgress();

                if (typeof showToast === 'function') {
                    showToast('Download canceled');
                }
            } catch (error) {
                console.error(error);
                showToast ? showToast(`Error cancelling download: ${error}`) : 
                            alert(`Error cancelling download: ${error}`);
            }
        }
    });

    function startProgressTracking() {
        progressInterval = setInterval(async () => {
            if (isDownloading) {
                try {
                    const progress = await invoke('get_download_progress');
                    console.log("Progress update:", progress);
                    updateProgressUI(progress);
                } catch (error) {
                    console.error('Error getting progress:', error);
                }
            }
        }, 500);

        listen('download-progress', (event) => {
            console.log("Progress event:", event);
            updateProgressUI(event.payload);
        }).then((unlisten) => {
            unlistenFn = unlisten;
        }).catch((err) => {
            console.error("Failed to set up event listener:", err);
        });
    }

    function stopProgressTracking() {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }

        if (unlistenFn) {
            unlistenFn();
            unlistenFn = null;
        }
    }

    function updateProgressUI(progress) {
        progressBar.style.width = `${progress.percentage}%`;
        progressText.textContent = `${progress.percentage.toFixed(1)}%`;
        progressSpeed.textContent = progress.speed;
        progressEta.textContent = progress.eta ? `ETA: ${progress.eta}` : '';

        if (progress.filename) {
            filename.textContent = `File: ${progress.filename}`;
        }

        if (typeof updateFooterStatus === 'function') {
            updateFooterStatus(`Downloading: ${progress.percentage.toFixed(1)}%`);
        }
    }

    function resetProgress() {
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        progressSpeed.textContent = '';
        progressEta.textContent = '';
        filename.textContent = '';

        if (typeof updateFooterStatus === 'function') {
            updateFooterStatus('Ready to download');
        }
    }

    function isValidYoutubeUrl(url) {
        const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+/;
        return pattern.test(url);
    }

    function initWindowControls() {
        const minimizeBtn = document.getElementById('minimize-btn') || document.querySelector('.fa-minus')?.parentElement;
        const maximizeBtn = document.getElementById('maximize-btn') || document.querySelector('.fa-square')?.parentElement;
        const closeBtn = document.getElementById('close-btn') || document.querySelector('.fa-xmark')?.parentElement;

        console.log("Setting up window controls...");

        if (window.__TAURI__) {

            if (minimizeBtn) {
                minimizeBtn.addEventListener('click', () => {
                    try {
                        console.log("Minimize button clicked");
                        if (window.__TAURI__.window.appWindow) {
                            window.__TAURI__.window.appWindow.minimize();
                        }
                        else if (typeof window.__TAURI__.window.getCurrent === 'function') {
                            const appWindow = window.__TAURI__.window.getCurrent();
                            appWindow.minimize();
                        }
                    } catch (error) {
                        console.error("Failed to minimize window:", error);
                    }
                });
            }

            if (maximizeBtn) {
                maximizeBtn.addEventListener('click', () => {
                    try {
                        console.log("Maximize button clicked");

                        if (window.__TAURI__.window.appWindow) {
                            window.__TAURI__.window.appWindow.toggleMaximize();
                        }

                        else if (typeof window.__TAURI__.window.getCurrent === 'function') {
                            const appWindow = window.__TAURI__.window.getCurrent();
                            appWindow.toggleMaximize();
                        }
                    } catch (error) {
                        console.error("Failed to maximize/restore window:", error);
                    }
                });
            }

            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    try {
                        console.log("Close button clicked");

                        if (window.__TAURI__.window.appWindow) {
                            window.__TAURI__.window.appWindow.close();
                        }

                        else if (typeof window.__TAURI__.window.getCurrent === 'function') {
                            const appWindow = window.__TAURI__.window.getCurrent();
                            appWindow.close();
                        }
                    } catch (error) {
                        console.error("Failed to close window:", error);
                    }
                });
            }

            console.log("Window controls initialized successfully");
        } else {
            console.log("Tauri API not available - window controls disabled");
        }
    }
    if (typeof showToast !== 'function') {
        window.showToast = function(message) {

            let toastContainer = document.querySelector('.toast-container');

            if (!toastContainer) {
                toastContainer = document.createElement('div');
                toastContainer.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2';
                document.body.appendChild(toastContainer);
            }

            const toast = document.createElement('div');
            toast.className = 'bg-black border border-red-800 text-white px-4 py-3 rounded shadow-lg flex items-center max-w-md';
            toast.innerHTML = `
                <i class="fa-solid fa-circle-info mr-3"></i>
                <span>${message}</span>
            `;
            toastContainer.appendChild(toast);

            setTimeout(() => {
                toast.remove();
            }, 3000);
        };
    }

    if (typeof updateFooterStatus !== 'function') {
        window.updateFooterStatus = function(status) {
            const footerStatus = document.querySelector('.footer-status');
            if (footerStatus) {
                footerStatus.textContent = status;
            }
        };
    }

    if (typeof addToDownloadHistory !== 'function') {
        window.addToDownloadHistory = function(item) {
            const recentSection = document.querySelector('.recently-downloaded');
            if (!recentSection) return;

            const downloadHistory = document.querySelector('.download-history');
            if (!downloadHistory) return;

            const historyItem = document.createElement('div');
            historyItem.className = 'bg-black/50 rounded-lg p-3 border border-gray-800 flex justify-between items-center';
            historyItem.innerHTML = `
                <div class="flex items-center min-w-0">
                    <div class="w-10 h-10 bg-red-900/20 rounded flex items-center justify-center text-red-900 mr-3">
                        <i class="fa-${item.format === 'mp3' ? 'solid fa-music' : 'brands fa-youtube'}"></i>
                    </div>
                    <div class="truncate">
                        <div class="text-white truncate">${item.title || 'YouTube Video'}</div>
                        <div class="text-xs text-gray-500">${item.format.toUpperCase()}</div>
                    </div>
                </div>
                <button class="text-gray-500 hover:text-red-700 transition-colors">
                    <i class="fa-solid fa-folder-open"></i>
                </button>
            `;

            downloadHistory.prepend(historyItem);
            recentSection.classList.remove('hidden');
        };
    }
});