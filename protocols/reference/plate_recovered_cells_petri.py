from opentrons import protocol_api
import requests
from opentrons import types  # ✅ Correct importfrom itertools import groupby
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
    "protocolName": "Plate Transformed Cells on Petri Dish V1.4",
    "description": "A protocol to Plate 96 wells of transformed cells in 8 Petri Dishes with selective media",
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
    petri_dish1 = protocol.load_labware("jd_petri_dish", "D2")  # Check exact name
    petri_dish2 = protocol.load_labware("jd_petri_dish", "C2") 
    petri_dish3 = protocol.load_labware("jd_petri_dish", "B2")  # Check exact name
    petri_dish4 = protocol.load_labware("jd_petri_dish", "A2") # Check exact name
    petri_dishes = [petri_dish1, petri_dish2, petri_dish3, petri_dish4]


    left_pipette = protocol.load_instrument(
        "flex_1channel_50",
        mount="left",
        tip_racks=[tips1]
    )

    heat_mod.set_temperature(37)

    # Define spot positions for 4x3 grid (12 spots)
    spacing = 18  # mm
    rows = 3
    cols = 4

    # Get dish center (assuming single well for petri dish)
    ##################### Transfer Cells to Selective Media #####################
    # Generate grid positions relative to center
    spot_positions = []
    for row in range(rows):
        for col in range(cols):
            x_offset = (col - (cols-1)/2) * spacing
            y_offset = (row - (rows-1)/2) * spacing
            spot_positions.append((x_offset, y_offset))
    
    # Spot the cultures (process in batches of 12 for each petri dish)
    # Access wells row-wise instead of column-wise
    wells_row_wise = [well for row in cells.rows() for well in row]
    total_wells = len(wells_row_wise)
    
    # Process 4 petri dishes at a time (48 wells total per set)
    wells_per_dish = 12
    dishes_per_set = 1
    wells_per_set = wells_per_dish * dishes_per_set  # 48 wells
    
    num_sets = (total_wells + wells_per_set - 1) // wells_per_set  # Round up
    
    for set_num in range(num_sets):
        protocol.comment(f"Starting set {set_num + 1}/{num_sets} of petri dishes")
        
        # Process each of the 4 petri dishes in this set
        for dish_idx in range(dishes_per_set):
            global_dish_num = set_num * dishes_per_set + dish_idx
            start_well = global_dish_num * wells_per_dish
            end_well = min(start_well + wells_per_dish, total_wells)
            
            if start_well >= total_wells:
                break  # No more wells to process
            
            # Get the current petri dish
            current_dish = petri_dishes[dish_idx]
            dish_well = current_dish.wells()[0]
            
            protocol.comment(f"Processing petri dish {global_dish_num + 1} at position {dish_idx + 1}/4 (wells {start_well + 1}-{end_well})")
            
            for i in range(start_well, end_well):
                spot_index = i % wells_per_dish  # Position within the current grid (0-11)
                x_offset, y_offset = spot_positions[spot_index]
                
                left_pipette.pick_up_tip()
                left_pipette.aspirate(15, wells_row_wise[i])

                # Move to spot position (2mm above agar surface)
                spot_location = dish_well.top().move(
                    types.Point(x=x_offset, y=y_offset, z=-10)
                )
                left_pipette.dispense(5, spot_location, rate=2)
                    
                left_pipette.drop_tip()
        
        # After completing all 4 petri dishes in this set, notify and pause
        notify_slack(f"Set {set_num + 1}/{num_sets} complete (4 petri dishes done) - Replace all 4 dishes")
        
        # Don't pause after the last set
        if set_num < num_sets - 1:
            protocol.pause("Please replace all 4 petri dishes and click Resume")
    
    
