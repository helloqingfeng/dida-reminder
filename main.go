package main

import (
	_ "embed"
	"log"

	"github.com/egoist/mygo"
)

//go:embed resources/icon.png
var trayIcon []byte

func main() {
	app := mygo.App
	// Set the name first: it determines the user data directory.
	app.SetName("DidaReminder")

	// Only one running copy; a second launch focuses the first.
	if !app.RequestSingleInstanceLock() {
		return
	}

	svc, err := NewReminders()
	if err != nil {
		log.Fatal(err)
	}
	mygo.Bind(svc)

	var win *mygo.Window
	var alertWin *mygo.Window
	// Set once a quit is under way so the hide-on-close handlers below stop
	// preventing the close; otherwise App.Quit cancels itself and only hides.
	var quitting bool
	showWindow := func() {
		if win == nil || win.IsDestroyed() {
			return
		}
		win.Restore()
		win.Show()
		win.Focus()
	}

	app.WhenReady(func() {
		win = mygo.NewWindow(mygo.WindowOptions{
			Title:           "滴答提醒",
			Width:           820,
			Height:          680,
			MinWidth:        560,
			MinHeight:       480,
			BackgroundColor: "#f4f1ea", // the page's --page-bg
			StateKey:        "main",
			URL:             "/",
		})
		// Closing the window hides it to the tray instead of quitting.
		win.OnClose(func(e *mygo.CloseEvent) {
			if quitting {
				return
			}
			e.PreventDefault()
			win.Hide()
		})

		// A separate small frameless window carries only the alert popup so
		// the main interface never jumps to the front when a reminder fires.
		alertWin = mygo.NewWindow(mygo.WindowOptions{
			Title:           "滴答提醒",
			Width:           400,
			Height:          360,
			Frameless:       true,
			AlwaysOnTop:     true,
			SkipTaskbar:     true,
			DisableResize:   true,
			Hidden:          true,
			BackgroundColor: "#ffffff",
			URL:             "/?view=alert",
		})
		alertWin.OnClose(func(e *mygo.CloseEvent) {
			if quitting {
				return
			}
			e.PreventDefault()
			svc.Dismiss()
		})

		svc.Activate = showWindow
		// Show only the popup window above everything while an alert is
		// pending; hide it once the queue is empty. The main window stays put.
		svc.OnQueueActive = func(active bool) {
			if alertWin == nil || alertWin.IsDestroyed() {
				return
			}
			if active {
				alertWin.Show()
			} else {
				alertWin.Hide()
			}
		}

		// Replace the browser's right-click menu with app actions; the stock
		// Back/Refresh/Print items are useless in a reminder tool.
		win.Page().OnContextMenu(func(e *mygo.ContextMenuEvent) {
			e.Menu = mygo.NewMenu([]*mygo.MenuItem{
				{Label: "新建提醒", Click: func(*mygo.MenuItem, *mygo.Window) { UiAction.Broadcast("new") }},
				{Label: "立即测试提醒", Click: func(*mygo.MenuItem, *mygo.Window) { svc.TestAlert() }},
				mygo.Separator(),
				{Label: "全部暂停", Click: func(*mygo.MenuItem, *mygo.Window) { svc.PauseAll() }},
				{Label: "全部恢复", Click: func(*mygo.MenuItem, *mygo.Window) { svc.ResumeAll() }},
				{Label: "删除全部提醒", Click: func(*mygo.MenuItem, *mygo.Window) {
					if svc.Count() == 0 {
						return
					}
					res, err := mygo.Dialog.Message(mygo.MessageOptions{
						Parent:             win,
						Type:               mygo.MessageQuestion,
						Title:              "滴答提醒",
						Message:            "确定删除全部提醒？",
						Detail:             "此操作不可撤销，将清空所有提醒和待处理弹窗。",
						Buttons:            []string{"删除", "取消"},
						DefaultButton:      1,
						CancelButton:       1,
						DestructiveButtons: []int{0},
					})
					if err == nil && res.Button == 0 {
						svc.DeleteAll()
					}
				}},
				mygo.Separator(),
				{Label: "开机自启", Type: mygo.MenuItemCheckbox, Checked: svc.GetAutoStart(), Click: func(it *mygo.MenuItem, _ *mygo.Window) { _ = svc.SetAutoStart(it.Checked) }},
				{Label: "退出", Click: func(*mygo.MenuItem, *mygo.Window) { mygo.App.Quit() }},
			})
		})
		// The popup window has no useful context actions: show no menu.
		alertWin.Page().OnContextMenu(func(e *mygo.ContextMenuEvent) {
			e.PreventDefault()
		})

		menu := mygo.NewMenu([]*mygo.MenuItem{
			{Label: "显示主界面", Click: func(*mygo.MenuItem, *mygo.Window) { showWindow() }},
			mygo.Separator(),
			{Label: "退出", Click: func(*mygo.MenuItem, *mygo.Window) { mygo.App.Quit() }},
		})
		tray, err := mygo.NewTray(mygo.TrayOptions{
			ID:      "main",
			Icon:    trayIcon,
			ToolTip: "滴答提醒",
			Menu:    menu,
		})
		if err != nil {
			log.Printf("tray unavailable: %v", err)
		} else {
			tray.OnClick(showWindow)
		}

		app.OnSecondInstance(func(args []string, workingDir string) { showWindow() })
		svc.start()
	})

	// Keep the app alive in the tray when the window is hidden.
	app.OnBeforeQuit(func(*mygo.QuitEvent) { quitting = true })
	app.OnWindowAllClosed(func() {})
	app.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows {
			showWindow()
		}
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}