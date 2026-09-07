---
status: accepted
---
# UI Language is a separate setting from Nation selection

The interface Language (English or Italian) and the set of Nations shown in the
Catalog are independent settings. First run infers both from the browser
locale, and either can be changed alone. We rejected coupling them because an
Italian reader abroad wants Italian UI and British Publications, and "English"
is not a Nation. One codebase and one deployment serve every Nation; per-country
builds were rejected as duplicate maintenance.
