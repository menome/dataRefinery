# TheLink - dataRefinery

This turns specifically formatted AMQP messages into neo4j graph updates.

### Example Message Format
```json
{
  "Name":"Konrad Aust",
  "NodeType":"Employee",
  "Priority": 1,
  "SourceSystem": "HRSystem",
  "ConformedDimensions": {
    "Email": "konrad.aust@menome.com",
    "EmployeeId": 12345
  },
  "Properties": {
    "Status":"active",
    "PreferredName": "The Chazzinator",
    "ResumeSkills": "programming,peeling bananas from the wrong end,handstands,sweet kickflips"
  },
  "Connections": [
    {
      "Name": "Menome Victoria",
      "NodeType": "Office",
      "RelType": "LocatedInOffice",
      "ForwardRel": true,
      "ConformedDimensions": {
        "City": "Victoria"
      }
    },
    {
      "Name": "theLink",
      "NodeType": "Project",
      "RelType": "WorkedOnProject",
      "ForwardRel": true,
      "ConformedDimensions": {
        "Code": "5"
      }
    }
  ]
}
```

### Explanation

The graph updates should be incremental. Because of this, queries generated rely heavily on merge statements.

Merge statements require a 'conformed dimension' which is a property that can uniquely identify the node. For a user, that dimension may be their email or user ID. For a project, it may be the project number. Conformed dimensions should be unique and consistent across all systems.

Messages can be given a 'priority.' This is an integer. Higher priority messages will overwrite existing data that was tagged with a lower priority.

Connections are a list of other nodes with conformed dimensions that we should merge on. 
Each of these mirrors the top-level structure, but can not possess its own connections object.

### Configuration

Configuration is managed via [Mozilla Convict.](https://github.com/mozilla/node-convict). The Schema for config is part of our [bot framework.](https://github.com/menome/botframework/blob/master/src/config.js)

#### Example Environment Variable Configuration:
```sh
NEO4J_URL=<url> #the URL of the neo4j instance. eg. "bolt://neo4j"
NEO4J_USER=<username> #the username we're using to connect to neo4j. eg. 'neo4j'
NEO4J_PASS=<password> #the password for the user account. eg. 'swordfish'
RABBIT_URL=<url> #the URL of the RMQ server. eg. 'amqp://rabbitmq:rabbitmq@rabbit:5672?heartbeat=3600'
```

#### Example JSON Configuration:
```json
{
  "neo4j": {
    "url": "bolt://neo4j",
    "user": "neo4j",
    "pass": "swordfish"
  },
  "rabbit": {
    "url": "amqp://rabbitmq:rabbitmq@rabbit:5672?heartbeat=3600",
    "routingKey": "syncevents.harvester.updates",
    "exchange": "syncevents"
  },
  "maxConcurrentQueries": 5
}
```

## Property Priority

What do you do if two systems both contain employee objects, and some of their information overlaps? Eg. The HR System and Accounting System both contain an employee's `HourlyRate`, but have different values? Ideally, you'd want to use the value in the accounting system, as it would be more up to date.

This is where our source system priority comes into play. You can specify two parameters in the message, `Priority` and `SourceSystem`. Like so:

```json
{
  "Priority": 1,
  "SourceSystem": "HRSystem"
}
```

```json
{
  "Priority": 3,
  "SourceSystem": "AccountingSystem"
}
```
(Note that if you do not specify _both_ of these parameters, the logic will not be triggered and all supplied parameters will be added to the node.)

Nodes with these parameters will keep track of all the source systems feeding them, as well as the last recorded priority of those source systems and the specific properties that were added by those source systems. The properties of a created node might look something like this:

```json
{
  "SourceSystems": ["HRSystem","AccountingSystem"],
  "SourceSystemPriorities": [1,3],
  "SourceSystemProps_AccountingSystem": ["HourlyRate","BillingInfo","FinanceStuff"],
  "SourceSystemProps_HRSystem": ["PreferredName","ResumeSkills"],
  "HourlyRate": 15.00,
  "BillingInfo": "123 Fake St, ...",
  "FinanceStuff": "Something domain-specific",
  "PreferredName": "The Chazzinator",
  "ResumeSkills": "programming,peeling bananas from the wrong end,handstands,sweet kickflips"
}
```

A system with a higher priority will overwrite the properties of all systems with lesser or equal priority. eg. If a third system was added with priority 2, and that system supplied `HourlyRate` and `PreferredMeal` properties, the `PreferredMeal` property would be added to the node, but `HourlyRate` would be ignored because there is already a higher priority system that supplies that property.

There is currently no way to explicitly set priority per-property. (Eg. You can not give the HR system max priority on `PreferredName` and give the accounting system max priority on `HourlyRate`.) We have not yet uncovered a case where this is necessary, as you can simply omit the `PreferredName` from the higher priority system.

There is currently no management of property priorities on nodes created via the `Connections` section of the main schema. It is assumed that these nodes will have their properties merged in with another message at a later date, and that will take care of priority.

By default, nodes created via the `Connections` section will be flagged as unmerged, and won't show up in theLink queries until a message is received that merges the properties of that node in based on its conformed dimensions. Property priority can be managed at that stage, so it is not advised to include properties of related nodes in this section. Properties on the relationships themselves also have no explicit controls for property priority.

Also note that priority is specified within the individual message, and so it's scoped to within the created node.

## Possible Concerns
There is currently no way to handle deletion of nodes from source systems. We can either:
  * Create a new message schema that allows for deletion
  * Timestamp nodes on every import, so we know that certain nodes only existed prior to a certain date.

Seems like there's also a race condition when merging. If two statements merge on the same node, two nodes are created. As a solution, by default we only process one query at a time. Since the DB is acid compliant, this allows us to avoid the problem at the cost of a small slowdown on the sync. It also reduces the workload on the server by having sync queries running on only one core.

In the future Neo4j has hinted that they may fix this, but for now we'll have to stick to one query at a time.