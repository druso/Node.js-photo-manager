# Login
I need a function that requires a user to log in to access the application. User not logged in are public users, user who logs in are Admins. For now admin access is just a universal password, in the future we will support user credential (using google auth or similar). 
Logged in user is managed via JWT


# Admins vs public user
Admin has access to everything on the website (public or private)
public user has access to photo marked as "public", only through public link (if they go to homepage or project urls, they will be prompt to log in)
Some functions and frontend objects of the website are exclusive to admin users
## functions only available to admin users:
commit/reverse, Plan action (delete, jpg, jpg+raw), regenerate thumbails&preview, upload, create projects, move to, tagging
## frontend objects only available to admin users:
### in header
options hamburger menu, add photo icon
### in grid view
"all" view, "project" view, filters, action menu, Actions Menu, commit/revert bar
### in photo view detail panel
Project information and move button, "Plan section" where can select what to keep


# Public vs Private photo system
Images have the new property "public" or "private"
By default images are "private"
Images can be made "public" only by Admins:
- in the action menu for a group of selected photos 
- within photo viewer for a specific photo
All files related to that image will be considered public/private, thus accessible from public requests
private photos are accessible only by Admin signed requests 
Ad additional filter for "visibility" is added to the filtering options and menu


# Public links for sharing:
a user can create "shared link"
A shared link has a key, passed via the url, that will present a page filtered by a specific key. 
These pages and public photos within it will be visible to anyone using the link. 
a shared link looks like /shared/hashedkey
This will open a view similar to a Project view, but will show all photos assigned to that shared link. 
Am image can be assigned to multiple shared links
A shared link has the following properties: 
- Title: used in menus and top of the page
- Description (optional): used under the Title
- publiclink_ID: a unique id that identify the publiclink
- hashedkey (the key used in the link)
Images will have a property that is "shared links" and in it a list of publiclink_IDs ssigned to them will be present. Relation between images and shared links are mapped by this field (to be discussed for optimizations)
## admin view of public links
when accessed by admins public links will have the additional options admins have access to
the only difference with other list of images is that private images in a public link will be displaied to admin and they will have a grey shade on them.
Non existend URLs should return "404"


# Image link
if the image is public and the url is not related to a public link, (like all/imagename/) the image will still be displayed to a public user, but the url will fallback to the /imagename, this will show the image viewer, if closed the public user will be in the homepage thus be prompted to log in or directed to /all if he's an admin.

#  Relationship between public link and private photo
if a photo is private, even if it's assigned to a public link it won't be displayed. A public link with only private photo in it will appear empty to a public user.

# Management of public links
Admin can manage public links in the page /publiclinks
link to it will be available in the setting hamburger menu
in it a list of public link is visible with: 
- possibility to edit title and description
- possibility to regenerate the hashedkey (with alert for confirming, this may have public user loose access)
- possibility to eliminate the public link (with alert for confirming, this may have public user loose access)
- link to access the public link


# Creation or adding images to a public link
## images grid
Admin can create a public links from the action menu, once images are selected in any image grid of the application
the "share" button will open a modal exactly like the "Move to.." button (will show public links already available, if the user write something new he can generate a new public link).
Only difference is that images can be assigned to multiple public links, so it will let the user select multiple public links. 
## image detail
inside the image detail, admins will see a "add to public link" "audit public links" buttons, these will open 2 modals
### add to public link
same modal as in the share for action menu will appear, from there the user can create a new link or assign the image.
### audit public links 
will show the list of public links where the image is present, the admin can deselect the one he don't want the image to be featured in, confirm and remove it.