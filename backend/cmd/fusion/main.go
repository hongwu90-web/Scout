package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/0x2E/fusion/internal/config"
	"github.com/0x2E/fusion/internal/handler"
	"github.com/0x2E/fusion/internal/monitor"
	"github.com/0x2E/fusion/internal/pull"
	"github.com/0x2E/fusion/internal/store"
	"github.com/gin-gonic/gin"
	"github.com/mattn/go-isatty"
	"golang.org/x/sync/errgroup"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	setupLogger(cfg)
	gin.SetMode(gin.ReleaseMode)

	st, err := store.New(cfg.DBPath)
	if err != nil {
		return err
	}
	defer st.Close()

	puller := pull.New(st, cfg)
	monitorEngine := monitor.NewEngine(st, cfg)

	if len(os.Args) > 1 && (os.Args[1] == "--pull-once" || os.Args[1] == "-pull-once") {
		slog.Info("executing single pull for all feeds")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		if puller.GetCloudFeedSync() != nil && puller.GetCloudFeedSync().IsEnabled() {
			slog.Info("syncing with cloud monitor in pull-once mode")
			if imported, err := puller.GetCloudFeedSync().FullSync(ctx, 1); err != nil {
				slog.Warn("cloud feed sync failed during pull-once", "error", err)
			} else if imported > 0 {
				slog.Info("imported offline cloud feed items during pull-once", "count", imported)
			}
		}
		count, err := puller.RefreshAll(ctx)
		if err != nil {
			slog.Error("pull-once failed", "error", err)
			return err
		}
		slog.Info("pull-once completed successfully", "feeds_refreshed", count)
		return nil
	}

	h, err := handler.New(st, cfg, puller)
	if err != nil {
		return err
	}
	h.SetMonitorEngine(monitorEngine)
	r := h.SetupRouter()

	host := cfg.Host
	if host == "" {
		host = "127.0.0.1"
	}
	addr := host + ":" + strconv.Itoa(cfg.Port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	sigCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	g, ctx := errgroup.WithContext(sigCtx)

	g.Go(func() error {
		slog.Info("starting server", "address", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	})

	g.Go(func() error {
		if err := puller.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
		return nil
	})

	g.Go(func() error {
		monitorEngine.Start(ctx)
		return nil
	})

	g.Go(func() error {
		<-ctx.Done()
		slog.Info("shutting down")
		monitorEngine.Stop()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("failed to shutdown server", "error", err)
		}

		return nil
	})

	return g.Wait()
}

func setupLogger(cfg *config.Config) {
	var level slog.Level
	switch cfg.LogLevel {
	case "DEBUG":
		level = slog.LevelDebug
	case "INFO":
		level = slog.LevelInfo
	case "WARN":
		level = slog.LevelWarn
	case "ERROR":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level: level,
	}

	var handler slog.Handler
	switch cfg.LogFormat {
	case "json":
		handler = slog.NewJSONHandler(os.Stdout, opts)
	case "text":
		handler = slog.NewTextHandler(os.Stdout, opts)
	case "auto":
		if isatty.IsTerminal(os.Stdout.Fd()) {
			handler = slog.NewTextHandler(os.Stdout, opts)
		} else {
			handler = slog.NewJSONHandler(os.Stdout, opts)
		}
	default:
		if isatty.IsTerminal(os.Stdout.Fd()) {
			handler = slog.NewTextHandler(os.Stdout, opts)
		} else {
			handler = slog.NewJSONHandler(os.Stdout, opts)
		}
	}

	logger := slog.New(handler)
	slog.SetDefault(logger)
}
