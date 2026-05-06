# Reify relationships when they carry attributes

When a relationship between two object types has its own attributes (e.g. `relation_type`, `knowledge_state` on a "character ↔ character" link), model the relationship itself as an `ObjectType` whose instances each represent one such link. Store the endpoints in the relationship-instance's `relationships` jsonb and the relationship's own attributes as plain properties.

This keeps modelling within today's platform shape: `ObjectRelationship` is type-level (which two types may relate), and `objectInstance.relationships` jsonb stores instance-level pointers as id lists with no attached metadata. Reification absorbs both constraints — the metadata moves onto a first-class row.

The cost is a hop: "all relations of character X" becomes "find `CharacterRelation` instances pointing at X" rather than "read X.relationships". This is the standard trade-off of relationship reification (see also DDD/ER literature). Accept the hop; do not invent instance-level relationship attributes ad hoc on a per-customer basis.

If multiple customers later need attributed relations and the hop becomes a recurring complaint, that is the trigger to consider promoting attributed instance-level relationships to a platform primitive. Until then, reification is the answer.
