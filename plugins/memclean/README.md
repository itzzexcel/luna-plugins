# MemClean for Tidal 🧹

Aggressively reduces and stabilizes Tidal Desktop's RAM and VRAM usage.

## What it does

1. **Off-Screen Image Trimming (`ImageTrimmer`)**:
   - Uses an `IntersectionObserver` with a safe 350px buffer to detect album covers and artist banners scrolling out of view.
   - Detaches uncompressed decoded bitmaps from RAM when off-screen and seamlessly restores them right before you scroll back to them.
   - Prevents long playlists and search grids from ballooning to 1+ GB.

2. **Background Hibernation (`Hibernator`)**:
   - When Tidal is minimized or hidden in the background, it pauses unnecessary CSS animations and pauses video playback buffers in Now Playing.

3. **Track-Change Memory Purge (`GCManager`)**:
   - Between songs, runs an idle memory release to discard lingering audio metadata and lyrics from the track that just finished.
   - If Chromium was launched with `--js-flags="--expose-gc"`, triggers direct V8 sweeps.

## Optional: Super Low-RAM Launch Shortcut

To cap Tidal's memory usage at the Electron engine level:

Right click your Tidal Desktop shortcut -> **Properties** -> in **Target**, append at the end:
```text
--js-flags="--max-old-space-size=512" --disk-cache-size=104857600
```
This forces V8's heap ceiling to 512 MB and prevents disk/memory cache bloat.

