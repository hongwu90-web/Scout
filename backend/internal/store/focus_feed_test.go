package store

import (
	"testing"
)

func TestFocusFeeds(t *testing.T) {
	st, err := New(":memory:")
	if err != nil {
		t.Fatalf("setup test store: %v", err)
	}
	defer st.Close()

	userID, err := st.EnsureUser("admin", "hash")
	if err != nil {
		t.Fatalf("ensure user: %v", err)
	}

	group, err := st.CreateGroup(userID, "Default Group")
	if err != nil {
		t.Fatalf("create group: %v", err)
	}

	feed1, err := st.CreateFeed(userID, group.ID, "Tech News", "https://example.com/tech", "https://example.com", "")
	if err != nil {
		t.Fatalf("create feed 1: %v", err)
	}

	feed2, err := st.CreateFeed(userID, group.ID, "Central Banks", "https://example.com/banks", "https://example.com", "")
	if err != nil {
		t.Fatalf("create feed 2: %v", err)
	}

	// Create items
	item1, err := st.CreateItem(userID, feed1.ID, "g1", "TSMC to expand advanced chip packaging facility", "https://example.com/1", "lithography news", 100)
	if err != nil {
		t.Fatalf("create item 1: %v", err)
	}
	_, err = st.CreateItem(userID, feed1.ID, "g2", "Local housing market update", "https://example.com/2", "housing news", 200)
	if err != nil {
		t.Fatalf("create item 2: %v", err)
	}
	item3, err := st.CreateItem(userID, feed2.ID, "g3", "PBOC cuts reserve ratio to boost semiconductor lending", "https://example.com/3", "chip policy", 300)
	if err != nil {
		t.Fatalf("create item 3: %v", err)
	}

	// 1. Create Focus Feed for Semiconductors
	ff, err := st.CreateFocusFeed(userID, group.ID, "Semiconductor Focus", "TSMC, chip, semiconductor", "", "cpu")
	if err != nil {
		t.Fatalf("CreateFocusFeed: %v", err)
	}
	if ff.Name != "Semiconductor Focus" {
		t.Errorf("unexpected focus feed name: %s", ff.Name)
	}

	// 2. Check unread count (should match item1 and item3 = 2 unread)
	if ff.UnreadCount != 2 {
		t.Errorf("expected 2 unread items for focus feed, got %d", ff.UnreadCount)
	}

	// 3. List items for focus feed
	items, err := st.ListFocusFeedItems(userID, ff, ListItemsParams{})
	if err != nil {
		t.Fatalf("ListFocusFeedItems: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	if items[0].ID != item3.ID || items[1].ID != item1.ID {
		t.Errorf("expected items [item3, item1], got ids [%d, %d]", items[0].ID, items[1].ID)
	}

	// 4. Update Focus Feed keywords
	newKw := "TSMC, lithography"
	updated, err := st.UpdateFocusFeed(userID, ff.ID, nil, &newKw, nil, nil, nil)
	if err != nil {
		t.Fatalf("UpdateFocusFeed: %v", err)
	}
	if updated.UnreadCount != 1 {
		t.Errorf("expected 1 unread item after keyword update, got %d", updated.UnreadCount)
	}

	// 5. Delete Focus Feed
	err = st.DeleteFocusFeed(userID, ff.ID)
	if err != nil {
		t.Fatalf("DeleteFocusFeed: %v", err)
	}
	_, err = st.GetFocusFeed(userID, ff.ID)
	if err == nil {
		t.Errorf("expected error getting deleted focus feed")
	}
}
