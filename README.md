# CDC Deadline Status - IIT KGP

A Chrome extension that saves IIT Kharagpur students from the soul-crushing experience of manually tracking CV submission deadlines on the world's most user-friendly ERP system.

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Download-blue)](https://chromewebstore.google.com/)

## 🎯 Problem Solved

IIT KGP's CDC (Career Development Cell) maintains a placement portal that's about as modern as a floppy disk. Students have to:
- Manually scroll through endless tables to find company deadlines
- Memorize dates or use sticky notes (because who needs digital reminders?)
- Click on each company individually to check CGPA requirements (because why make it easy?)
- Panic when they miss deadlines because "the system was slow"
- Question their life choices while navigating the ERP labyrinth

This extension fixes that nonsense by automatically:
- Coloring the placement table based on deadline status
- Fetching and displaying CGPA requirements directly in the table
- Showing eligibility at a glance (if you meet the CGPA requirement)

## 🚀 Features

### Smart Color Coding
- 🟢 **Green**: Applied and deadline is still open (you're safe... for now)
- 🟡 **Yellow**: Haven't applied yet but deadline hasn't passed (hurry up!)
- 🔴 **Red**: Deadline passed and you haven't applied (better luck next time)

### CGPA Requirements (NEW! 🎉)
- **Automatic CGPA Fetching**: Fetches CGPA requirements for all open companies automatically when you load the page
- **Table Badges**: See CGPA requirements directly in the table as badges before each role
  - ✓ Green badge: You meet the CGPA requirement
  - ✗ Red badge: You don't meet the requirement (shows required CGPA)
  - CG badge: CGPA requirement shown (set your CGPA in popup for eligibility check)
- **Smart Caching**: CGPA data is cached so it doesn't re-fetch on every page load
- **Parallel Fetching**: Fetches up to 5 companies simultaneously for speed
- **Priority Fetching**: Automatically prioritizes "Open" companies first

### Modern Dashboard
- Clean popup interface showing all your companies
- Filter by status (Applied/Can Apply/Missed)
- Search by company name
- Sort by deadline or company name
- **CGPA Display**: See CGPA requirements and eligibility for each company
- **User CGPA Input**: Set your CGPA to see eligibility status
- Customizable colors (because why not?)

### Deep Scanning
- Automatically loads all virtualized table rows
- Real-time progress updates
- Handles CDC's "infinite scroll" tables like a boss
- **Auto CGPA Fetch**: Automatically fetches CGPA after deep scan completes

## 🛠️ Installation

### From Chrome Web Store
1. Visit the [Chrome Web Store](https://chromewebstore.google.com/)
2. Search for "CDC Deadline Status - IIT KGP"
3. Click "Add to Chrome"
4. Profit!

### Manual Installation (For Developers)
1. Clone this repo:
   ```bash
   git clone https://github.com/yourusername/cdc-deadline-status.git
   cd cdc-deadline-status
   ```

2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the cloned directory
6. The extension should appear in your toolbar

## 📖 Usage

1. **Open ERP**: Navigate to IIT KGP's placement portal
2. **Watch Magic Happen**: 
   - The extension automatically colors the table rows
   - Deep scan starts automatically to load all companies
   - CGPA fetching begins automatically after scan completes
3. **Set Your CGPA**: 
   - Click the extension icon
   - Enter your CGPA in the input field
   - Click "Save" to see eligibility badges
4. **Check Dashboard**: Click the extension icon for a clean overview with CGPA requirements
5. **Manual CGPA Fetch**: Click "Fetch CGPA" button if you want to manually refresh CGPA data
6. **Customize**: Change colors in settings if green makes you queasy

## 🎨 Customization

Access settings through the extension popup:
- Change the green/yellow/red colors
- Reset to defaults if you mess up

## 🔧 How It Works

The extension injects content scripts into ERP pages that:
1. Parse the ancient jqGrid table structure
2. Extract company names, deadlines, and application status
3. Apply color coding based on current time vs deadlines
4. **Extract `jnf_id` and `com_id` from table row links**
5. **Fetch CGPA requirements from `TPJNFView.jsp` endpoint**
6. **Parse HTML responses to extract CGPA cutoffs and eligibility**
7. **Display CGPA badges directly on the table**
8. Store data for the popup dashboard

**Note**: This extension only works on IIT KGP's ERP system. It won't magically fix your CGPA, but it will tell you if you meet the requirements!

## 🐛 Known Issues & Workarounds

- **"Extension not working?"**: Refresh the ERP page. CDC probably changed something again.
- **"Colors look wrong?"**: Check your system time. Don't blame the extension for your timezone confusion.
- **"Still shows red for yellow companies?"**: ERP changed date formats again. We fixed it, but CDC might change it back.
- **"CGPA badges not showing?"**: 
  - Make sure the deep scan has completed (check progress bar)
  - CGPA fetching happens automatically after scan - wait a bit
  - Click "Fetch CGPA" manually if needed
  - Badges only show for "Open" companies (yellow status)
- **"CGPA shows but eligibility is wrong?"**: Make sure you've set your CGPA in the popup settings

## 🏗️ Technical Details

- **Manifest Version**: 3 (because Manifest V2 is deprecated, unlike CDC's systems)
- **Content Scripts**: Inject into `https://erp.iitkgp.ac.in/IIT_ERP3/showmenu.htm`
- **Storage**: Uses Chrome's local storage for settings, cached data, and CGPA cache
- **Date Parsing**: Handles CDC's ever-changing date formats (DD-MM-YYYY → YYYY-MM-DD → who knows next)
- **CGPA Fetching**: 
  - Background `fetch()` calls to `TPJNFView.jsp` endpoint
  - Parses HTML responses using `DOMParser` to extract CGPA cutoffs
  - Concurrent fetching (5 parallel requests) for performance
  - Permanent caching (no expiration) to avoid redundant requests
  - Extracts `jnf_id` and `com_id` from table row `onclick` handlers

## 🤝 Contributing

Found a bug? Want to add features? CDC changed something again?

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Test on actual ERP (the horror!)
5. Submit a PR

## 📜 License

MIT License - because sharing is caring, and CDC definitely didn't share their source code.

## 🙏 Acknowledgments

- IIT Kharagpur for the "learning experience" that is their ERP system
- CDC for keeping things interesting by changing things without notice
- jqGrid for making web tables as modern as punch cards
- Bootstrap for being the only thing that works in this mess

## 🎭 Disclaimer

This extension is not affiliated with IIT Kharagpur or CDC. It was created by students, for students, to survive the placement season. Use at your own risk. Missing deadlines is still your responsibility.

---

**Made with ❤️ and lots of frustration by IIT KGP students who deserve better tools.**
