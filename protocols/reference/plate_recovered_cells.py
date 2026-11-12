from opentrons import protocol_api
import requests
from itertools import groupby
from operator import itemgetter
#function for Slack notification
# Set to "<@YOUR_MEMBER_ID>" to be tagged in this run's alerts.
# Slack profile -> ... -> Copy member ID. Empty means no tag.
SLACK_USER_ID = ""


def notify_slack(message):
    webhook_url = ""
    try:
        requests.post(webhook_url, json={"text": f"{SLACK_USER_ID} {message}".strip()})
    except Exception as e:
        print(f"Slack notification failed: {e}")

metadata = {
    "protocolName": "Plate Transformed Cells V1.0",
    "description": "A protocol to Plate 96 wells of transformed cells in 4 24 well plates with selective media",
    "author": "JATD"
}

requirements = {
    "robotType": "Flex", # Ensure the robot type is Flex,
    "apiLevel": "2.23",
    }

def run(protocol: protocol_api.ProtocolContext):
    # load the labware
    tips1 = protocol.load_labware("opentrons_flex_96_tiprack_50ul", "C1")
    trash = protocol.load_trash_bin("A3")
    heat_mod = protocol.load_module(module_name="temperatureModuleV2", location="D1")
    cells = heat_mod.load_labware("corning_96_wellplate_360ul_flat")
    kan_plate1 = protocol.load_labware("corning_24_wellplate_3.4ml_flat", "A2")
    kan_plate2 = protocol.load_labware("corning_24_wellplate_3.4ml_flat", "B2")
    kan_plate3 = protocol.load_labware("corning_24_wellplate_3.4ml_flat", "C2")
    kan_plate4 = protocol.load_labware("corning_24_wellplate_3.4ml_flat", "D2")


    left_pipette = protocol.load_instrument(
        "flex_1channel_50",
        mount="left",
        tip_racks=[tips1]
    )

    heat_mod.set_temperature(37)

    ##################### Transfer Cells to Selective Media #####################
    
    kan_plate_list = [kan_plate1, kan_plate2, kan_plate3, kan_plate4]
    for i, well in enumerate(cells.wells()):
        left_pipette.pick_up_tip()
        left_pipette.aspirate(5, well)
        target_plate = kan_plate_list[i // 24]
        target_well = target_plate.wells()[i % 24]
        left_pipette.dispense(5, target_well.bottom(5), rate=0.5)
        left_pipette.drop_tip()
    notify_slack("Plating of recovered cells complete - Proceed to incubation")
