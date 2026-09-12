package store

import (
	"database/sql"
	"errors"
	"fmt"
	"testing"
)

func TestListItems(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Test Group")
	feed1 := mustCreateFeed(t, store, group.ID, "Feed 1", "https://example.com/feed1", "https://example.com", "")
	feed2 := mustCreateFeed(t, store, group.ID, "Feed 2", "https://example.com/feed2", "https://example.com", "")

	// Create items with deterministic pub_date ordering.
	item1 := mustCreateItem(t, store, feed1.ID, "guid-1", "Item 1", "https://example.com/1", "Content 1", 100)
	item2 := mustCreateItem(t, store, feed1.ID, "guid-2", "Item 2", "https://example.com/2", "Content 2", 200)
	item3 := mustCreateItem(t, store, feed2.ID, "guid-3", "Item 3", "https://example.com/3", "Content 3", 300)

	// Mark item2 as read
	if err := store.UpdateItemUnread(1, item2.ID, false); err != nil {
		t.Fatalf("UpdateItemUnread() failed: %v", err)
	}

	t.Run("list all items", func(t *testing.T) {
		items, err := store.ListItems(1, ListItemsParams{})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(items) != 3 {
			t.Errorf("expected 3 items, got %d", len(items))
		}
	})

	t.Run("filter by feed_id", func(t *testing.T) {
		items, err := store.ListItems(1, ListItemsParams{FeedID: &feed1.ID})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(items) != 2 {
			t.Errorf("expected 2 items for feed1, got %d", len(items))
		}
	})

	t.Run("filter by unread=true", func(t *testing.T) {
		unread := true
		items, err := store.ListItems(1, ListItemsParams{Unread: &unread})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(items) != 2 {
			t.Errorf("expected 2 unread items, got %d", len(items))
		}
	})

	t.Run("filter by unread=false", func(t *testing.T) {
		unread := false
		items, err := store.ListItems(1, ListItemsParams{Unread: &unread})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(items) != 1 {
			t.Errorf("expected 1 read item, got %d", len(items))
		}
	})

	t.Run("pagination with limit and cursor", func(t *testing.T) {
		// First page: no cursor, returns the 2 newest items (item3 @300, item2 @200).
		page1, err := store.ListItems(1, ListItemsParams{Limit: 2})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(page1) != 2 {
			t.Fatalf("expected 2 items on first page, got %d", len(page1))
		}
		if page1[0].ID != item3.ID || page1[1].ID != item2.ID {
			t.Errorf("expected first page [item3, item2], got ids [%d, %d]", page1[0].ID, page1[1].ID)
		}

		// Second page: cursor from the last item of page1 (item2).
		last := page1[len(page1)-1]
		page2, err := store.ListItems(1, ListItemsParams{
			Limit:         2,
			BeforePubDate: &last.PubDate,
			BeforeID:      &last.ID,
		})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(page2) != 1 {
			t.Fatalf("expected 1 item on second page, got %d", len(page2))
		}
		if page2[0].ID != item1.ID {
			t.Errorf("expected second page [item1], got id %d", page2[0].ID)
		}

		// Beyond-last page: cursor from the final item returns nothing.
		last = page2[len(page2)-1]
		page3, err := store.ListItems(1, ListItemsParams{
			Limit:         2,
			BeforePubDate: &last.PubDate,
			BeforeID:      &last.ID,
		})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(page3) != 0 {
			t.Errorf("expected empty page beyond last item, got %d", len(page3))
		}
	})

	t.Run("filter by keyword query", func(t *testing.T) {
		items, err := store.ListItems(1, ListItemsParams{Query: "Item 2"})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(items) != 1 {
			t.Fatalf("expected 1 item for query 'Item 2', got %d", len(items))
		}
		if items[0].ID != item2.ID {
			t.Errorf("expected item2, got id %d", items[0].ID)
		}
	})

	t.Run("order by pub_date", func(t *testing.T) {
		items, err := store.ListItems(1, ListItemsParams{OrderBy: "pub_date"})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(items) != 3 {
			t.Fatalf("expected 3 items, got %d", len(items))
		}
		if items[0].ID != item3.ID || items[1].ID != item2.ID || items[2].ID != item1.ID {
			t.Error("items not ordered by pub_date DESC")
		}
	})

	t.Run("stable order when pub_date ties", func(t *testing.T) {
		if _, err := store.db.Exec(
			`UPDATE items SET pub_date = :pub_date`,
			sql.Named("pub_date", int64(100)),
		); err != nil {
			t.Fatalf("failed to set pub_date for tie test: %v", err)
		}

		items, err := store.ListItems(1, ListItemsParams{OrderBy: "pub_date"})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(items) != 3 {
			t.Fatalf("expected 3 items, got %d", len(items))
		}
		if items[0].ID != item3.ID || items[1].ID != item2.ID || items[2].ID != item1.ID {
			t.Error("items not ordered by pub_date DESC, id DESC")
		}
	})

	t.Run("order by created_at", func(t *testing.T) {
		if _, err := store.db.Exec(
			`UPDATE items SET created_at = :created_at WHERE id = :id`,
			sql.Named("created_at", int64(100)),
			sql.Named("id", item1.ID),
		); err != nil {
			t.Fatalf("failed to set created_at: %v", err)
		}
		if _, err := store.db.Exec(
			`UPDATE items SET created_at = :created_at WHERE id = :id`,
			sql.Named("created_at", int64(200)),
			sql.Named("id", item2.ID),
		); err != nil {
			t.Fatalf("failed to set created_at: %v", err)
		}
		if _, err := store.db.Exec(
			`UPDATE items SET created_at = :created_at WHERE id = :id`,
			sql.Named("created_at", int64(300)),
			sql.Named("id", item3.ID),
		); err != nil {
			t.Fatalf("failed to set created_at: %v", err)
		}

		items, err := store.ListItems(1, ListItemsParams{OrderBy: "created_at"})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(items) != 3 {
			t.Fatalf("expected 3 items, got %d", len(items))
		}
		if items[0].ID != item3.ID || items[1].ID != item2.ID || items[2].ID != item1.ID {
			t.Error("items not ordered by created_at DESC")
		}
	})

	t.Run("stable order when created_at ties", func(t *testing.T) {
		if _, err := store.db.Exec(`UPDATE items SET created_at = :created_at`, sql.Named("created_at", int64(100))); err != nil {
			t.Fatalf("failed to set created_at for tie test: %v", err)
		}

		items, err := store.ListItems(1, ListItemsParams{OrderBy: "created_at"})
		if err != nil {
			t.Fatalf("ListItems() failed: %v", err)
		}
		if len(items) != 3 {
			t.Fatalf("expected 3 items, got %d", len(items))
		}
		if items[0].ID != item3.ID || items[1].ID != item2.ID || items[2].ID != item1.ID {
			t.Error("items not ordered by created_at DESC, id DESC")
		}
	})
}

func TestListItemsFilterByGroupID(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group1 := mustCreateGroup(t, store, "Group 1")
	group2 := mustCreateGroup(t, store, "Group 2")

	feed1 := mustCreateFeed(t, store, group1.ID, "Feed 1", "https://example.com/group1", "https://example.com", "")
	feed2 := mustCreateFeed(t, store, group2.ID, "Feed 2", "https://example.com/group2", "https://example.com", "")

	mustCreateItem(t, store, feed1.ID, "guid-1", "Item 1", "https://example.com/1", "Content 1", 100)
	mustCreateItem(t, store, feed2.ID, "guid-2", "Item 2", "https://example.com/2", "Content 2", 200)

	items, err := store.ListItems(1, ListItemsParams{GroupID: &group1.ID})
	if err != nil {
		t.Fatalf("ListItems() failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item for group1, got %d", len(items))
	}
	if items[0].FeedID != feed1.ID {
		t.Errorf("expected item to be from feed1, got feed_id=%d", items[0].FeedID)
	}
}

func TestGetItem(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Test Group")
	feed := mustCreateFeed(t, store, group.ID, "Test Feed", "https://example.com/feed", "https://example.com", "")

	created := mustCreateItem(t, store, feed.ID, "guid-1", "Test Item", "https://example.com/1", "Content", 123)

	item, err := store.GetItem(1, created.ID)
	if err != nil {
		t.Fatalf("GetItem() failed: %v", err)
	}

	if item.ID != created.ID || item.Title != created.Title {
		t.Error("retrieved item doesn't match created item")
	}

	_, err = store.GetItem(1, 99999)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent item, got %v", err)
	}
}

func TestCreateItem(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Test Group")
	feed := mustCreateFeed(t, store, group.ID, "Test Feed", "https://example.com/feed", "https://example.com", "")

	guid := "unique-guid-1"
	title := "Test Item"
	link := "https://example.com/item"
	content := "Test content"
	pubDate := int64(123)

	item := mustCreateItem(t, store, feed.ID, guid, title, link, content, pubDate)

	if item.GUID != guid || item.Title != title || item.Link != link || item.Content != content {
		t.Error("item fields don't match input")
	}

	if !item.Unread {
		t.Error("expected unread to default to true")
	}

	if item.ID == 0 || item.CreatedAt == 0 {
		t.Error("expected auto-populated fields to be set")
	}

	_, err := store.CreateItem(1, feed.ID, guid, "Different Title", link, content, pubDate)
	if err == nil {
		t.Error("expected error when creating duplicate feed_id+guid, got nil")
	}
}

func TestUpdateItemUnread(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Test Group")
	feed := mustCreateFeed(t, store, group.ID, "Test Feed", "https://example.com/feed", "https://example.com", "")
	item := mustCreateItem(t, store, feed.ID, "guid-1", "Test Item", "https://example.com/1", "Content", 123)

	if err := store.UpdateItemUnread(1, item.ID, false); err != nil {
		t.Fatalf("UpdateItemUnread() failed: %v", err)
	}

	updated, err := store.GetItem(1, item.ID)
	if err != nil {
		t.Fatalf("GetItem() failed: %v", err)
	}
	if updated.Unread {
		t.Error("expected unread to be false")
	}

	if err := store.UpdateItemUnread(1, item.ID, true); err != nil {
		t.Fatalf("UpdateItemUnread() failed: %v", err)
	}

	updated2, err := store.GetItem(1, item.ID)
	if err != nil {
		t.Fatalf("GetItem() failed: %v", err)
	}
	if !updated2.Unread {
		t.Error("expected unread to be true")
	}
}

func TestUpdateItemUnreadNotFound(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	err := store.UpdateItemUnread(1, 99999, false)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestBatchUpdateItemsUnread(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Test Group")
	feed := mustCreateFeed(t, store, group.ID, "Test Feed", "https://example.com/feed", "https://example.com", "")

	item1 := mustCreateItem(t, store, feed.ID, "guid-1", "Item 1", "https://example.com/1", "Content 1", 100)
	item2 := mustCreateItem(t, store, feed.ID, "guid-2", "Item 2", "https://example.com/2", "Content 2", 200)
	item3 := mustCreateItem(t, store, feed.ID, "guid-3", "Item 3", "https://example.com/3", "Content 3", 300)

	ids := []int64{item1.ID, item2.ID}
	if err := store.BatchUpdateItemsUnread(1, ids, false); err != nil {
		t.Fatalf("BatchUpdateItemsUnread() failed: %v", err)
	}

	updated1, err := store.GetItem(1, item1.ID)
	if err != nil {
		t.Fatalf("GetItem() failed: %v", err)
	}
	updated2, err := store.GetItem(1, item2.ID)
	if err != nil {
		t.Fatalf("GetItem() failed: %v", err)
	}
	updated3, err := store.GetItem(1, item3.ID)
	if err != nil {
		t.Fatalf("GetItem() failed: %v", err)
	}

	if updated1.Unread || updated2.Unread {
		t.Error("expected items 1 and 2 to be read")
	}
	if !updated3.Unread {
		t.Error("expected item 3 to remain unread")
	}

	if err := store.BatchUpdateItemsUnread(1, []int64{}, true); err != nil {
		t.Errorf("BatchUpdateItemsUnread() with empty ids should not error: %v", err)
	}
}

func TestBatchUpdateItemsUnreadChunked(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Chunk Group")
	feed := mustCreateFeed(t, store, group.ID, "Chunk Feed", "https://example.com/chunk-feed", "https://example.com", "")

	inputs := make([]BatchCreateItemInput, 0, 520)
	for i := range 520 {
		inputs = append(inputs, BatchCreateItemInput{
			GUID:    fmt.Sprintf("chunk-guid-%d", i),
			Title:   "Chunk Item",
			Link:    fmt.Sprintf("https://example.com/chunk/%d", i),
			Content: "Chunk Content",
			PubDate: int64(1000 + i),
		})
	}

	inserted, err := store.BatchCreateItemsIgnore(1, feed.ID, inputs)
	if err != nil {
		t.Fatalf("BatchCreateItemsIgnore() failed: %v", err)
	}
	if inserted != len(inputs) {
		t.Fatalf("expected %d created items, got %d", len(inputs), inserted)
	}

	items, err := store.ListItems(1, ListItemsParams{FeedID: &feed.ID})
	if err != nil {
		t.Fatalf("ListItems() failed: %v", err)
	}

	ids := make([]int64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}

	if err := store.BatchUpdateItemsUnread(1, ids, false); err != nil {
		t.Fatalf("BatchUpdateItemsUnread() failed: %v", err)
	}

	unread := true
	unreadCount, err := store.CountItems(1, ListItemsParams{FeedID: &feed.ID, Unread: &unread})
	if err != nil {
		t.Fatalf("CountItems() failed: %v", err)
	}
	if unreadCount != 0 {
		t.Fatalf("expected 0 unread items, got %d", unreadCount)
	}
}

func TestMarkAllAsRead(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Test Group")
	feed1 := mustCreateFeed(t, store, group.ID, "Feed 1", "https://example.com/feed1", "https://example.com", "")
	feed2 := mustCreateFeed(t, store, group.ID, "Feed 2", "https://example.com/feed2", "https://example.com", "")

	item1 := mustCreateItem(t, store, feed1.ID, "guid-1", "Item 1", "https://example.com/1", "Content 1", 100)
	item2 := mustCreateItem(t, store, feed1.ID, "guid-2", "Item 2", "https://example.com/2", "Content 2", 200)
	item3 := mustCreateItem(t, store, feed2.ID, "guid-3", "Item 3", "https://example.com/3", "Content 3", 300)

	t.Run("mark all items in a specific feed", func(t *testing.T) {
		if err := store.MarkAllAsRead(1, &feed1.ID); err != nil {
			t.Fatalf("MarkAllAsRead() failed: %v", err)
		}

		updated1, err := store.GetItem(1, item1.ID)
		if err != nil {
			t.Fatalf("GetItem() failed: %v", err)
		}
		updated2, err := store.GetItem(1, item2.ID)
		if err != nil {
			t.Fatalf("GetItem() failed: %v", err)
		}
		updated3, err := store.GetItem(1, item3.ID)
		if err != nil {
			t.Fatalf("GetItem() failed: %v", err)
		}

		if updated1.Unread || updated2.Unread {
			t.Error("expected feed1 items to be read")
		}
		if !updated3.Unread {
			t.Error("expected feed2 items to remain unread")
		}
	})

	if err := store.UpdateItemUnread(1, item3.ID, true); err != nil {
		t.Fatalf("UpdateItemUnread() failed: %v", err)
	}

	t.Run("mark all items across all feeds", func(t *testing.T) {
		if err := store.MarkAllAsRead(1, nil); err != nil {
			t.Fatalf("MarkAllAsRead() failed: %v", err)
		}

		updated3, err := store.GetItem(1, item3.ID)
		if err != nil {
			t.Fatalf("GetItem() failed: %v", err)
		}
		if updated3.Unread {
			t.Error("expected all items to be read")
		}
	})
}

func TestItemExists(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Test Group")
	feed := mustCreateFeed(t, store, group.ID, "Test Feed", "https://example.com/feed", "https://example.com", "")

	guid := "test-guid"
	mustCreateItem(t, store, feed.ID, guid, "Test Item", "https://example.com/1", "Content", 123)

	exists, err := store.ItemExists(1, feed.ID, guid)
	if err != nil {
		t.Fatalf("ItemExists() failed: %v", err)
	}
	if !exists {
		t.Error("expected item to exist")
	}

	exists, err = store.ItemExists(1, feed.ID, "guid-nonexistent")
	if err != nil {
		t.Fatalf("ItemExists() failed: %v", err)
	}
	if exists {
		t.Error("expected item not to exist")
	}
}

func TestSearchItemsUsesFTS(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Search Group")
	feed := mustCreateFeed(t, store, group.ID, "Search Feed", "https://example.com/search.xml", "https://example.com", "")

	mustCreateItem(t, store, feed.ID, "s-1", "Go Concurrency", "https://example.com/a", "channels and goroutines", 100)
	item2 := mustCreateItem(t, store, feed.ID, "s-2", "Daily Notes", "https://example.com/b", "golang release", 200)

	results, err := store.SearchItems(1, "Go", 10)
	if err != nil {
		t.Fatalf("SearchItems() failed: %v", err)
	}
	if len(results) == 0 {
		t.Fatal("expected non-empty search results")
	}
	if results[0].ID != item2.ID {
		t.Fatalf("expected latest matching item first, got id=%d", results[0].ID)
	}
}

func TestSearchItemsFTSReflectsUpdateAndDelete(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "FTS Group")
	feed := mustCreateFeed(t, store, group.ID, "FTS Feed", "https://example.com/fts.xml", "https://example.com", "")

	item := mustCreateItem(t, store, feed.ID, "fts-1", "Title", "https://example.com/fts", "alpha token", 100)

	results, err := store.SearchItems(1, "alpha", 10)
	if err != nil {
		t.Fatalf("SearchItems() failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result for alpha, got %d", len(results))
	}

	if _, err := store.db.Exec(`UPDATE items SET content = :content WHERE id = :id`, sql.Named("content", "beta token"), sql.Named("id", item.ID)); err != nil {
		t.Fatalf("update item content failed: %v", err)
	}

	results, err = store.SearchItems(1, "alpha", 10)
	if err != nil {
		t.Fatalf("SearchItems() failed: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("expected 0 results for alpha after update, got %d", len(results))
	}

	results, err = store.SearchItems(1, "beta", 10)
	if err != nil {
		t.Fatalf("SearchItems() failed: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result for beta after update, got %d", len(results))
	}

	if _, err := store.db.Exec(`DELETE FROM items WHERE id = :id`, sql.Named("id", item.ID)); err != nil {
		t.Fatalf("delete item failed: %v", err)
	}

	results, err = store.SearchItems(1, "beta", 10)
	if err != nil {
		t.Fatalf("SearchItems() failed: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("expected 0 results for beta after delete, got %d", len(results))
	}
}

func TestMarkItemsReadByDate(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Date Group")
	feed1 := mustCreateFeed(t, store, group.ID, "Feed 1", "https://example.com/feed1", "https://example.com", "")
	feed2 := mustCreateFeed(t, store, group.ID, "Feed 2", "https://example.com/feed2", "https://example.com", "")

	// item1: 100, item2: 200, item3: 300
	mustCreateItem(t, store, feed1.ID, "guid-1", "Item 1", "https://example.com/1", "Content 1", 100)
	mustCreateItem(t, store, feed1.ID, "guid-2", "Item 2", "https://example.com/2", "Content 2", 200)
	mustCreateItem(t, store, feed2.ID, "guid-3", "Item 3", "https://example.com/3", "Content 3", 300)

	// Mark older than 250 in feed1 (should mark item1 and item2 as read)
	cutoff := int64(250)
	if err := store.MarkItemsReadByDate(1, &feed1.ID, nil, &cutoff); err != nil {
		t.Fatalf("MarkItemsReadByDate failed: %v", err)
	}

	unreadTrue := true
	unreadItems, err := store.ListItems(1, ListItemsParams{Unread: &unreadTrue})
	if err != nil {
		t.Fatalf("ListItems failed: %v", err)
	}
	if len(unreadItems) != 1 {
		t.Fatalf("expected 1 unread item (item3), got %d", len(unreadItems))
	}
	if unreadItems[0].GUID != "guid-3" {
		t.Fatalf("expected unread item to be guid-3, got %s", unreadItems[0].GUID)
	}
}

func TestDeleteReadItems_PreventsReingestion(t *testing.T) {
	store, _ := setupTestDB(t)
	defer closeStore(t, store)

	group := mustCreateGroup(t, store, "Test Group")
	feed := mustCreateFeed(t, store, group.ID, "Test Feed", "https://example.com/feed", "https://example.com", "")

	// Create 2 items
	item1 := mustCreateItem(t, store, feed.ID, "item-1", "Article 1", "https://example.com/1", "Content 1", 100)
	mustCreateItem(t, store, feed.ID, "item-2", "Article 2", "https://example.com/2", "Content 2", 200)

	// Mark item1 as read
	if err := store.UpdateItemUnread(1, item1.ID, false); err != nil {
		t.Fatalf("UpdateItemUnread failed: %v", err)
	}

	// Purge read items
	affected, purged, err := store.DeleteReadItems(1, &feed.ID, nil)
	if err != nil {
		t.Fatalf("DeleteReadItems failed: %v", err)
	}
	if affected != 1 || len(purged) != 1 {
		t.Fatalf("expected 1 affected and 1 purged record, got %d, %d", affected, len(purged))
	}
	if purged[0].GUID != "item-1" {
		t.Fatalf("expected purged guid to be item-1, got %s", purged[0].GUID)
	}

	// Verify item1 is deleted from items table
	_, err = store.GetItem(1, item1.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected item1 to be deleted from items, got err: %v", err)
	}

	// Simulate re-fetching the feed: the feed contains item-1 (purged) and item-3 (new)
	inputs := []BatchCreateItemInput{
		{GUID: "item-1", Title: "Article 1", Link: "https://example.com/1", Content: "Content 1", PubDate: 100},
		{GUID: "item-3", Title: "Article 3", Link: "https://example.com/3", Content: "Content 3", PubDate: 300},
	}

	newCount, err := store.BatchCreateItemsIgnore(1, feed.ID, inputs)
	if err != nil {
		t.Fatalf("BatchCreateItemsIgnore failed: %v", err)
	}

	// Only item-3 should have been inserted! item-1 MUST be rejected because it was purged!
	if newCount != 1 {
		t.Fatalf("expected exactly 1 newly inserted item (item-3), got %d", newCount)
	}

	// Verify item-1 is still NOT in the items table
	items, err := store.ListItems(1, ListItemsParams{FeedID: &feed.ID})
	if err != nil {
		t.Fatalf("ListItems failed: %v", err)
	}
	for _, it := range items {
		if it.GUID == "item-1" {
			t.Fatalf("CRITICAL ERROR: purged item-1 was re-ingested into items table!")
		}
	}
}

