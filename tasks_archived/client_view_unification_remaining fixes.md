

# viewer action menu:
/all : 
- it contains both "move to.." and "Actions" menus -> remove "move to.." completely there is no longer need for such menu.
- if i click "Actions" menu I get the following error on the console and the page goes blank:
"""OperationsMenu.jsx:188  Uncaught TypeError: Cannot read properties of undefined (reading 'size')
    at OperationsMenu (OperationsMenu.jsx:188:50)
    at Object.react_stack_bottom_frame (react-dom-client.development.js:23863:20)
    at renderWithHooks (react-dom-client.development.js:5529:22)
    at updateFunctionComponent (react-dom-client.development.js:8897:19)
    at beginWork (react-dom-client.development.js:10522:18)
    at runWithFiberInDEV (react-dom-client.development.js:1519:30)
    at performUnitOfWork (react-dom-client.development.js:15132:22)
    at workLoopSync (react-dom-client.development.js:14956:41)
    at renderRootSync (react-dom-client.development.js:14936:11)
    at performWorkOnRoot (react-dom-client.development.js:14462:44)
OperationsMenu @ OperationsMenu.jsx:188
react_stack_bottom_frame @ react-dom-client.development.js:23863
renderWithHooks @ react-dom-client.development.js:5529
updateFunctionComponent @ react-dom-client.development.js:8897
beginWork @ react-dom-client.development.js:10522
runWithFiberInDEV @ react-dom-client.development.js:1519
performUnitOfWork @ react-dom-client.development.js:15132
workLoopSync @ react-dom-client.development.js:14956
renderRootSync @ react-dom-client.development.js:14936
performWorkOnRoot @ react-dom-client.development.js:14462
performSyncWorkOnRoot @ react-dom-client.development.js:16231
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:16079
processRootScheduleInMicrotask @ react-dom-client.development.js:16116
(anonymous) @ react-dom-client.development.js:16250
<OperationsMenu>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:346
App @ App.jsx:1623
react_stack_bottom_frame @ react-dom-client.development.js:23863
renderWithHooksAgain @ react-dom-client.development.js:5629
renderWithHooks @ react-dom-client.development.js:5541
updateFunctionComponent @ react-dom-client.development.js:8897
beginWork @ react-dom-client.development.js:10522
runWithFiberInDEV @ react-dom-client.development.js:1519
performUnitOfWork @ react-dom-client.development.js:15132
workLoopSync @ react-dom-client.development.js:14956
renderRootSync @ react-dom-client.development.js:14936
performWorkOnRoot @ react-dom-client.development.js:14419
performSyncWorkOnRoot @ react-dom-client.development.js:16231
flushSyncWorkAcrossRoots_impl @ react-dom-client.development.js:16079
processRootScheduleInMicrotask @ react-dom-client.development.js:16116
(anonymous) @ react-dom-client.development.js:16250
<App>
exports.jsxDEV @ react-jsx-dev-runtime.development.js:346
(anonymous) @ main.jsx:12
App.jsx:1623  An error occurred in the <OperationsMenu> component.

Consider adding an error boundary to your tree to customize error handling behavior.
Visit https://react.dev/link/error-boundaries to learn more about error boundaries."""

This way viewer action menu  *must* be exactly the same wether I open it from ALL or from pn, simplify the code as much as you can. Remove unused code.


# Detailed view (when I open an image)
/All: 
- has "Project" with "Open in project". Remove "Open in project" add the "move" button to open the "move modal"
- lacks "Plan" section with "Delete" "JPG" "JPG+RAW", add it.
/pn
- lacks "Project" section, add it with the edits from /All
This way Detailed view *must* be exactly the same wether I open it from ALL or from pn, simplify the code as much as you can. Remove unused code.


# Upload modal
/All:
- if start the upload process by either the + button in the header or dropping an image on the view port I get a modal with "Select Target Project". I would like this to:
	- Instead of showing a list, show a input box, writing either the name or the id it will suggest an existing one or propose to create a new project.
	- once selected I will have an x to remove the selection and be able to write again, or a button "confirm" to confirm the selected project
	- if the selected string is not a project the "confirm" is going to be "create project", thus creating the project and uploading the images there

/pn
- same behavior than above, but with a small change:
	- the modal starts with the current project already selected, possibility to use the x to remove selection.

# "Move" modal
currently it says  "Select a destination project. 1 selected."
I would like it to be "Select a destination project. 1 selected from projects:..." and the list of projects of the selected images separated by comma